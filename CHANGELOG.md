# Changelog

Notable changes to this project. Release notes are also generated automatically on each
[GitHub release](https://github.com/sus-tech-gmbh/matrix42-mcp/releases).

This project follows [Semantic Versioning](https://semver.org). Until 1.0.0, minor versions may
contain breaking changes to tool inputs; they will always be called out here.

## 0.1.5 — 2026-08-21

### Changed

- **The ASQL guide now says that people and roles on a ticket are relations.** It explained dot
  chains in the abstract, which was not enough to stop a name filter looking reasonable: a ticket
  has no `InitiatorName` column, so `Initiator`, `Recipient` and `RecipientRole` have to be
  traversed. The guide names the working expressions, including the `T(SPSSecurityClassRole)` pivot
  a role needs because `SPSScRoleClassBase` carries no attributes of its own. A test pins the
  lesson so it cannot quietly disappear.

## 0.1.4 — 2026-08-21

### Added

- **`ticket_actions` action `transform`** — turns tickets into another type through Matrix42’s
  transmutation contract (an incident into a service request, a ticket into a problem). It
  rewrites what the record IS, so it previews like every other write and names that consequence
  explicitly: fields the target type does not have are lost. Verified end to end on a throwaway
  ticket, which changed from SPSActivityTypeServiceRequest to SPSActivityTypeIncident.

### Fixed

- The refusal for a filter Matrix42 ignores now hands over **the ASQL that works** instead of vague
  advice. `Initiator` is a relation to `SPSUserClassBase`, so `Initiator.LastName` filters
  correctly through `data_query` — proved by comparing row counts: 102 unfiltered, 11 for a real
  surname, 0 for one nobody has. The previous message said "use an ASQL where clause" without ever
  naming one that worked.

## 0.1.3 — 2026-08-21

### Fixed

- **`search_tickets` could return every ticket for a filtered request.** Matrix42’s Search
  contract accepts `initiator_name`, `ticket_number`, `recipient_name`, `recipient_role_name`,
  `asset_id` and `service_id` — and then ignores them. Verified against a live instance by
  searching for a person who does not exist: the result was the full ticket list, not an empty
  one. A caller had no way to tell, so "Ada’s open tickets" would confidently return everyone’s.

  Only `subject`, `category_name` and `states` actually narrow the result. Those are the only
  parameters now sent; passing one of the others is **refused**, with a message pointing at
  `data_query` with an ASQL `where`, which does filter on them. Refusing is deliberate — silently
  dropping the filter would still let a caller believe it had been applied.

  Earlier releases advertised name-based ticket search as a headline feature. It never worked.

- `states` is sent with a match-all subject, because Matrix42 rejects it as a search on its own
  while still applying it as a filter.

## 0.1.2 — 2026-08-21

### Fixed

- The CLI and the MCP handshake reported a hardcoded version that `npm version` never updated, so
  0.1.1 introduced itself as 0.1.0. The version is now read from the package manifest, and a test
  fails if the two ever disagree again.

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
