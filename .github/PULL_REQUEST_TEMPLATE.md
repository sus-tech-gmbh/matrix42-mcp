## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

<!-- Unit tests are the minimum. If you ran it against a real instance, say which Matrix42 version. -->

- [ ] `npm run typecheck && npm test && npm run build` all pass
- [ ] Ran against a live instance (version: )

## Project rules

- [ ] **No guessed attribute names** — every column is resolved against the live schema
- [ ] **No Matrix42 copyrighted code or documentation text** — guides link to the official docs
- [ ] Guides edited? `npm run docs` re-run so `docs/` matches
- [ ] New behaviour has tests covering the happy path, the error path and an edge case
