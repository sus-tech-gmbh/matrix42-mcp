# Changelog

Notable changes to this project. Release notes are also generated automatically on each
[GitHub release](https://github.com/sus-tech-gmbh/matrix42-mcp/releases).

This project follows [Semantic Versioning](https://semver.org). Until 1.0.0, minor versions may
contain breaking changes to tool inputs; they will always be called out here.

## 0.1.1 — 2026-08-21

No functional changes. This is the first release published from CI through
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so it is the first tarball to
carry [provenance](https://docs.npmjs.com/generating-provenance-statements) linking it to the commit
and workflow run that built it. 0.1.0 was published by hand to create the package.

## 0.1.0 — 2026-08-21

### Added

- **`service_desk` tool** — uniform ticket search across all seven kinds through Matrix42's shared
  Search contract, filtered by person and category *name* rather than ids; service-level answers;
  a curated browser over thirteen domains; and `find`, which searches every domain at once.
- **Ticket lifecycle verbs** — take over, accept, forward, pause, reopen, return to role, set
  deadline, track working time.
- **Preview-then-confirm writes.** Every write returns the exact request it would send until
  `confirm: true` is passed. The preview is the same plan object the execute path runs.
- **Creation audit note.** A created ticket gets an internal journal entry recording that it was
  raised through this server. Configurable via `M42_AUDIT_NOTE` and `M42_AGENT_LABEL`.
- **MCP prompts** — `explore_instance`, `build_query`, `triage_ticket`, `safe_change`,
  `find_endpoint`.
- **MCP resources** — the four written guides, also generated into `docs/` with a drift test.
- **`data_query` action `deep_link`** — URLs into the Matrix42 web interface. Takes just an object’s
  id and resolves the configuration item itself, since a base definition is reused by many of them.
  A fragment id is refused rather than turned into a link that opens nothing. Links target the web
  interface's own origin, read from the instance's web shell config, because that is frequently not
  the host the API is reached on; `M42_UI_URL` overrides it. Supports preview, edit, create and
  action links, verified by opening generated URLs in a signed-in browser.
- **Schema-driven column resolution.** Projections are resolved against the live schema before every
  query, so a field a module does not install is reported rather than sent.

### Fixed

Contracts corrected against a live instance:

- Ticket `Search` refuses to run without criteria, and answers in a `Tickets` or `KbArticles`
  envelope — previously reported as zero rows.
- `TakeOver`/`Accept` declare `Objects` as an array, not an object.
- `Pause` requires a future `ReminderDate`; an omitted one binds to `DateTime.MinValue`.
- `TrackWorkingTime` requires `ActivityType`, `Begin` and `End`.
- `SLATimeDurationInfo` takes `activityId` and `duration`, not `ticketId`.
- `Forward` needs the role's `SPSScRoleClassBase` id, not its `SPSSecurityClassRole` id.
- `End` is a reserved word in the expression parser; identifiers are now bracket-escaped, and sort
  clauses name the projected output.
