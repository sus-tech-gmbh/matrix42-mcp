# Matrix42 REST API - integration overview

This describes the Matrix42 REST API itself: how to authenticate against it, which headers it cares
about, and where its data lives. It is what you need in order to write a script, connector or
workflow that talks to Matrix42 directly.

None of it is needed to use this MCP server's tools. Those already perform the token exchange and
set the authentication and localisation headers described below. The base path is
`https://<host>/m42Services/api/...`, and the connected host is reported by the `server_info` tool.

## Authentication

**API token, recommended.** Create an API token in the Administration application, then exchange it
for a short-lived access token:

    POST m42Services/api/ApiToken/GenerateAccessTokenFromApiToken
    Header: Authorization: Bearer <API_TOKEN>        (empty body, Content-Length: 0)
    Response: { "RawToken": "<access token>", "LifeTime": "<ISO-8601 expiry>" }

From there, `Authorization: Bearer <RawToken>` goes on every request, and the token is re-exchanged
once it expires. Sending the raw API token straight to a normal endpoint does not work; it has to be
exchanged first. If the exchange answers 200 with a literal `null` body, the API token is expired or
invalid.

**Basic auth, discouraged.** `Authorization: Basic base64(username:password)`. Some instances accept
the credentials and still refuse API access with 403, because of role or audience restrictions.

## Headers

    Authorization: Bearer <access token>            (or Basic ...)
    Content-Type: application/json;charset=UTF-8    (required when sending a POST/PUT body)
    Explicit-Language: de-DE | en-US | ...          controls the language of the response

The standard Accept-Language header is ignored by Matrix42, so Explicit-Language is the one that
matters. Omit it and Matrix42 falls back to the authenticated user's profile language.

## Methods

GET reads, POST creates, PUT updates, DELETE deletes. Request bodies must be well-formed JSON;
malformed JSON is not reported in a helpful way.

## Responses and errors

    2xx   success
    401   missing or invalid authentication
    403   authenticated, but the role or audience is not permitted (not a credentials problem)
    406   the presented token was not accepted, typically a raw API token that was never exchanged
    5xx   server error

## API stability

Operations reported with `isPublic = true` are Public API: stable and update-safe. Everything else
is Product API and may change between releases without notice, which makes the public ones the
better foundation for an integration that has to keep working.

## Common data surfaces

    Fragments:  m42Services/api/data/fragments/<DataDefinition>?Columns=...&Where=...&PageSize=...
    DataQuery:  m42Services/api/DataQuery/<dataQueryId>
    Schema:     m42Services/api/Schema/classes | m42Services/api/Schema/types

On the fragments endpoint, Columns supports aliases and relation traversal, as in
`Service.Name AS ServiceName`, and Where takes an ASQL expression, as in `Service.ID = '<guid>'`.

## Finding an endpoint

A typical instance exposes on the order of 1,100 operations, so browsing is impractical. Listing
operations with a search term returns each one as `{id, name, method, path, service, documentation}`,
and describing a single operation by its id gives the full parameter and return-type contract.

---

*This is the text the Matrix42 MCP server serves as the resource `matrix42://guide/api`.
It is generated from `src/api-overview.ts` - edit that file and run `npm run docs`.*
