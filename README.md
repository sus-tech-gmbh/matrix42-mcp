# Matrix42 MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Matrix42**. It lets an AI
assistant discover and understand your Matrix42 instance's REST API — which web services exist, what
operations they expose, and each operation's parameters and return types.

The server holds the credentials and talks to Matrix42 on the assistant's behalf: it performs the
API-token exchange, sets the `Explicit-Language` header, and handles TLS. The assistant never sees
your credentials.

> **Status:** early release. The server is **read-only by default**; write tools exist but are not
> exposed unless `M42_ALLOW_WRITES=1`.

---

## Why

Matrix42's API surface is large (a typical instance exposes ~190 web services and ~1,100 operations),
plus a data model of ~800 data definitions and ~240 configuration items, and an assistant has no way
to know what exists. Point it at this server and it can search for the
right endpoint, read the exact contract, and then write correct integration code — instead of
guessing at URLs, auth, and headers.

---

## Tools

| Tool | What it does |
| --- | --- |
| `server_info` | Reports which Matrix42 instance is connected and verifies the credentials work. Never returns credentials. |
| `webservice_discovery` | Discovers the REST API. See the actions below. |
| `schema_discovery` | Explores the data model: data definitions, configuration items, attributes, relations, pickup values. |
| `data_query` | Reads records: ASQL queries, saved views, journal entries, attachments, plus an ASQL guide and validator. |
| `ticket_actions` | **Writes** — create/close tickets and add journal entries. Only present when `M42_ALLOW_WRITES=1`. |

### `webservice_discovery` actions

| Action | Parameters | Returns |
| --- | --- | --- |
| `api_overview` | – | General Matrix42 API conventions: token exchange, `Explicit-Language`, Public vs Product API, common data surfaces. Useful before writing standalone integration code. |
| `list_operations` | `search?`, `service_id?`, `limit?` | Operations as `{id, name, method, path, service, documentation}`. `search` filters on name, documentation, and service name. Defaults to the first 200 matches; pass `limit: 0` for all. |
| `list_services` | – | Every web service with its route prefix and documentation. |
| `describe_operation` | `operation_id` | One operation's full contract: HTTP method, path, parameters with types, and return type. |

**Typical flow:** `api_overview` once → `list_operations` with a search term → `describe_operation`
on the one you want.

### `schema_discovery` actions

| Action | Parameters | Returns |
| --- | --- | --- |
| `schema_overview` | – | How the Matrix42 data model fits together: data definitions vs configuration items, fragments and multi-fragments, cardinality, pickups, and where to find the official docs. |
| `list_data_definitions` | `search?`, `include_pickups?`, `limit?` | Definitions as `{internalName, displayName, description, classType, isPickup, isCustom}`. Pickup classes are excluded unless asked for. |
| `list_configuration_items` | `search?`, `limit?` | Items with their main class and member definitions. |
| `describe_data_definition` | `name`, `include?` | Attributes with decoded datatypes and pickup cross-links. Relations are excluded by default (a central definition can have 150+) — pass `include: "relations"` or `"both"`. |
| `describe_configuration_item` | `name` | The definitions an object is composed of, each with its cardinality and a `isMultiFragment` flag. |
| `get_pickup_values` | `pickup_class` **or** `name`+`attribute` | The selectable `{value, label}` pairs — so a model filters on real values instead of guessing codes. |

**Typical flow:** `schema_overview` → `list_*` with a search term → `describe_*` → `get_pickup_values`
before filtering on any pickup attribute.

### `data_query` actions

| Action | Parameters | Returns |
| --- | --- | --- |
| `asql_guide` | – | The ASQL expression language used by `where` and `columns`: operators, dot chains, pickups, `T(...)` pivots, subqueries, `[Expression-ObjectID]`. |
| `validate_asql` | `class`, `expression` | Whether an expression is valid, with the exact error (e.g. *"does not contain attribute Nope"*). Cheaper than a failed query. |
| `query` | `class`, `columns?`, `where?`, `sort?`, `page_size?`, `page?` | Rows plus typed column metadata, with paging (`hasMore`). |
| `get_fragment` | `class`, `fragment_id` | One complete fragment. |
| `get_object` | `ci_name`, `object_id` | One whole object (all fragments of a configuration item). |
| `list_views` / `run_view` | `search?` / `view_id` | The instance's saved data queries — curated views that already carry a predefined filter. Prefer a matching view over hand-written ASQL. |
| `list_journal` | `object_id` | An object's comment/activity timeline. |
| `list_attachments` | `object_id` | The files attached to an object. |

**Typical flow:** `asql_guide` once → `schema_discovery` to find the class and its pickup values →
`validate_asql` → `query`. Always pass `sort` when paging; page boundaries are otherwise unstable.

Numeric enums are decoded for you (`Datatype: 2` → `"Int"`, `Cardinality: 3` → `"Optional (Multi)"`),
and customisations are flagged using the custom prefix the instance itself reports.

All tools are annotated `readOnlyHint: true`, so clients can distinguish them from anything that
would change data.

---

## Requirements

- **Node.js 20 or newer**
- A Matrix42 instance and either an **API token** (recommended) or basic-auth credentials

### Creating an API token

In the Matrix42 **Administration** application, create an API token for the account the assistant
should act as. The server exchanges it for a short-lived access token automatically and re-exchanges
it before it expires.

> Basic auth is supported but discouraged: many instances accept the credentials yet still refuse API
> access with `403` because of role/audience restrictions.

---

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `M42_HOST` | ✅ | – | Base URL of the instance, e.g. `https://matrix42.example.com` |
| `M42_API_TOKEN` | ✅¹ | – | API token; exchanged for an access token automatically |
| `M42_USERNAME` / `M42_PASSWORD` | ✅¹ | – | Basic-auth alternative to `M42_API_TOKEN` |
| `M42_LANGUAGE` | | `en-US` | Response language, sent as `Explicit-Language` |
| `M42_TOOLS` | | all | Comma-separated tool ids to expose |
| `M42_ALLOW_WRITES` | | `0` | Set to `1` to expose tools that modify data. Write tools are not registered at all unless this is set. |
| `M42_ALLOW_INSECURE_TLS` | | `0` | Set to `1` to skip TLS verification (self-signed dev instances only) |
| `M42_TIMEOUT_MS` | | `30000` | Per-request timeout |

¹ Provide **either** `M42_API_TOKEN` **or** both `M42_USERNAME` and `M42_PASSWORD`.

---

## Client setup

The server runs over **stdio**: your MCP client starts it. No install step is needed — `npx` fetches
it on demand.

### Claude Code

```bash
claude mcp add matrix42 \
  --env M42_HOST=https://matrix42.example.com \
  --env M42_API_TOKEN=your-api-token \
  -- npx -y matrix42-mcp
```

### Claude Desktop

`claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`)

```json
{
  "mcpServers": {
    "matrix42": {
      "command": "npx",
      "args": ["-y", "matrix42-mcp"],
      "env": {
        "M42_HOST": "https://matrix42.example.com",
        "M42_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project)

```json
{
  "mcpServers": {
    "matrix42": {
      "command": "npx",
      "args": ["-y", "matrix42-mcp"],
      "env": {
        "M42_HOST": "https://matrix42.example.com",
        "M42_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

`.vscode/mcp.json` — this shape prompts for the token instead of storing it in the file:

```json
{
  "inputs": [
    { "id": "m42-token", "type": "promptString", "description": "Matrix42 API token", "password": true }
  ],
  "servers": {
    "matrix42": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "matrix42-mcp"],
      "env": {
        "M42_HOST": "https://matrix42.example.com",
        "M42_API_TOKEN": "${input:m42-token}"
      }
    }
  }
}
```

Other stdio-capable clients (Windsurf, Cline, Zed, …) use the same `command` / `args` / `env` shape.

---

## Verifying the connection

Ask the assistant to call `server_info`, or run the bundled smoke test against your instance:

```bash
git clone https://github.com/sus-tech-gmbh/M42-MCP.git
cd M42-MCP && npm install && npm run build

M42_HOST=https://matrix42.example.com \
M42_API_TOKEN=your-api-token \
node scripts/smoke.mjs
```

It connects as a real MCP client and exercises every tool.

You can also run the CLI directly:

```bash
npx matrix42-mcp --help    # usage and configuration
npx matrix42-mcp --tools   # available tool ids
```

---

## Writing data

Write tools are absent from the tool list unless `M42_ALLOW_WRITES=1`, so a default deployment
cannot modify anything even if a model asks it to. When enabled, `ticket_actions` offers:

| Action | Notes |
| --- | --- |
| `create_ticket` | Returns the new **object id**, which the other two actions take directly. |
| `close_ticket` | Closes by object id, with an optional solution and closing reason. |
| `add_journal_entry` | Adds a comment to any object, with optional template `parameters`. |
| `classify_ticket` | Only suggests a type from text — changes nothing. |

Two defaults exist to prevent the mistakes that matter most in service management:

- **Notification e-mails are off.** `notify_initiator`, `notify_users` and `notify_responsible`
  all default to `false`; closing a ticket does not mail anyone unless you ask.
- **Journal entries are internal.** `visible_in_portal` defaults to `false`, so a comment is not
  published to the requester's self-service portal by accident.

`close_related_incidents` also defaults to `false`, since it cascades to other tickets.

## Security notes

- **The server is a credentialed proxy.** Anything the configured account can read through the API,
  a connected assistant can reach through the tools it is given. Use an account scoped to what the
  assistant actually needs.
- **Credentials stay local.** They are read from the environment, used only for requests to your
  instance, and never written to logs or returned by any tool.
- **Never commit `.env`.** It is git-ignored; use your client's `env` block or a secret prompt.
- **`M42_ALLOW_INSECURE_TLS` disables certificate verification.** Use it only for self-signed
  development instances, never against production.
- **Limit the surface with `M42_TOOLS`** if you only want part of it.

---

## Development

```bash
npm install
npm run build        # compile to dist/
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
node scripts/smoke.mjs   # end-to-end against a real instance
```

### Layout

```
src/
  index.ts           entry point: config → client → MCP stdio server
  config.ts          environment configuration + validation
  m42-client.ts      authenticated HTTP client (token exchange, caching, TLS)
  discovery.ts       fragment queries + projections for services/operations
  schema.ts          schema listings, detail projections, enum decoding, pickup resolution
  api-overview.ts    the static Matrix42 API guide served by api_overview
  schema-overview.ts the static data-model guide served by schema_overview
  data.ts            record queries, paging, result shaping, ASQL validation
  objects.ts         journal, attachments, saved views, current-user identity
  tickets.ts         write operations and their safety defaults
  asql-guide.ts      the static ASQL guide served by asql_guide
  tools/             one module per tool, registered from a small registry
```

Adding a tool means adding a module under `src/tools/` and listing it in `src/tools/index.ts`; its id
then works in `M42_TOOLS` automatically.

---

## Roadmap

- Attachment upload and download
- Approvals, and the change/problem/task lifecycles
- Per-user tokens, so "my items" can mean an end user rather than the service account

---

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck && npm test` before opening a PR.

## License

[MIT](LICENSE) © sus-tech GmbH

Not affiliated with or endorsed by Matrix42 AG.
