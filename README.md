# Matrix42 MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Matrix42**. It lets an AI
assistant discover and understand your Matrix42 instance's REST API — which web services exist, what
operations they expose, and each operation's parameters and return types.

The server holds the credentials and talks to Matrix42 on the assistant's behalf: it performs the
API-token exchange, sets the `Explicit-Language` header, and handles TLS. The assistant never sees
your credentials.

> **Status:** early release. Today every tool is **read-only** and returns *API metadata*, not
> business records.

---

## Why

Matrix42's API surface is large (a typical instance exposes ~190 web services and ~1,100 operations),
and an assistant has no way to know what exists. Point it at this server and it can search for the
right endpoint, read the exact contract, and then write correct integration code — instead of
guessing at URLs, auth, and headers.

---

## Tools

| Tool | What it does |
| --- | --- |
| `server_info` | Reports which Matrix42 instance is connected and verifies the credentials work. Never returns credentials. |
| `webservice_discovery` | Discovers the REST API. See the actions below. |

### `webservice_discovery` actions

| Action | Parameters | Returns |
| --- | --- | --- |
| `api_overview` | – | General Matrix42 API conventions: token exchange, `Explicit-Language`, Public vs Product API, common data surfaces. Useful before writing standalone integration code. |
| `list_operations` | `search?`, `service_id?`, `limit?` | Operations as `{id, name, method, path, service, documentation}`. `search` filters on name, documentation, and service name. Defaults to the first 200 matches; pass `limit: 0` for all. |
| `list_services` | – | Every web service with its route prefix and documentation. |
| `describe_operation` | `operation_id` | One operation's full contract: HTTP method, path, parameters with types, and return type. |

**Typical flow:** `api_overview` once → `list_operations` with a search term → `describe_operation`
on the one you want.

Both tools are annotated `readOnlyHint: true`, so clients can distinguish them from anything that
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
  api-overview.ts    the static Matrix42 API guide served by api_overview
  tools/             one module per tool, registered from a small registry
```

Adding a tool means adding a module under `src/tools/` and listing it in `src/tools/index.ts`; its id
then works in `M42_TOOLS` automatically.

---

## Roadmap

- Executing API operations (kept as a separate, explicitly annotated tool so read-only discovery and
  live calls can never be confused)
- Schema/data-definition discovery
- Read access to business records

---

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck && npm test` before opening a PR.

## License

[MIT](LICENSE) © sus-tech GmbH

Not affiliated with or endorsed by Matrix42 AG.
