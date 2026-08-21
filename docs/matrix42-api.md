# Matrix42 REST API — integration overview

Base path: https://<host>/m42Services/api/...   (the connected host is reported by the server_info tool)

IMPORTANT: When you call THIS MCP server's tools, the server already performs the token exchange and
sets the authentication + localization headers for you. You do NOT need any of the below to use these
tools. This overview is for reasoning about the API and for helping the user write standalone
integration code (scripts, connectors, workflows) that talks to Matrix42 directly.

## Authentication
- API token (recommended): create an API token in the Administration application, then exchange it
  for a short-lived access token:
    POST m42Services/api/ApiToken/GenerateAccessTokenFromApiToken
    Header: Authorization: Bearer <API_TOKEN>        (empty body, Content-Length: 0)
    Response: { "RawToken": "<access token>", "LifeTime": "<ISO-8601 expiry>" }
  Then send `Authorization: Bearer <RawToken>` on every request and re-exchange once it expires.
  NOTE: sending the raw API token directly to a normal endpoint does NOT work — it must be exchanged
  first. A response of 200 with a literal `null` body from the exchange means the API token is
  expired or invalid.
- Basic auth (discouraged): Authorization: Basic base64(username:password). Some instances accept
  the credentials but still refuse API access with 403 because of role/audience restrictions.

## Headers
- Authorization: Bearer <access token>   (or Basic ...)
- Content-Type: application/json;charset=UTF-8    (required when sending a POST/PUT body)
- Explicit-Language: de-DE | en-US | ...  — controls the language of the response.
  NOTE: the standard Accept-Language header is IGNORED by Matrix42; use Explicit-Language.
  If omitted, Matrix42 falls back to the authenticated user's profile language.

## Methods (CRUD)
GET = read, POST = create, PUT = update, DELETE = delete. Request bodies must be well-formed JSON;
malformed JSON is not reported in a helpful way.

## Responses & errors
2xx = success. 401 = missing/invalid authentication. 403 = authenticated, but the role/audience is
not permitted (NOT a credentials problem). 406 = the presented token was not accepted (typically a
raw API token that was never exchanged). 5xx = server error.

## API stability
Public API = stable and update-safe (operations reported with isPublic = true). Product API = may
change between releases without notice. Prefer Public operations for integrations.

## Common data surfaces
- Fragments:  m42Services/api/data/fragments/<DataDefinition>?Columns=...&Where=...&PageSize=...
    Columns supports aliases and relation traversal, e.g. "Service.Name AS ServiceName".
    Where uses A-SQL, e.g. "Service.ID = '<guid>'".
- DataQuery:  m42Services/api/DataQuery/<dataQueryId>
- Schema:     m42Services/api/Schema/classes | m42Services/api/Schema/types

## Finding an endpoint
Call webservice_discovery with action='list_operations' (optionally with a 'search' term) to get every
operation as {id, name, method, path, service, documentation}, then action='describe_operation' with
that operation's id for its full parameter and return-type contract.

---

*This is the text the Matrix42 MCP server serves as the resource `matrix42://guide/api`.
It is generated from `src/api-overview.ts` — edit that file and run `npm run docs`.*
