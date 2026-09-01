# Contributing

Thanks for considering a contribution. This is a community project: Matrix42 deployments differ
enormously, and the fastest way it improves is people reporting what their instance actually does.

## How branches work

Every change travels the same route, and nothing skips a step:

```
feature branch  ->  dev  ->  main
```

- **Feature branches** are where the work happens. Branch off `dev`, name the branch after what it
  does (`feat/browse-locations`, `fix/pause-reminder-date`, `docs/asql-relations`), and open the
  pull request against `dev`.
- **`dev`** is the integration branch. Everything lands here first, so changes that are fine on
  their own but clash with each other surface before a release rather than after one.
- **`main`** is the released branch. It only ever receives merges from `dev`, and releases are cut
  from it.

Starting a change:

```bash
git checkout dev
git pull
git checkout -b feat/your-change
```

A pull request opened against `main` will be asked to retarget `dev`. The one exception is a fix for
something already broken in a release: that may go straight to `main`, and is merged back into `dev`
afterwards so the two branches do not drift apart.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. CI runs them on Node 22 and 24.

If you changed a guide (`src/domain-guide.ts`, `src/schema-overview.ts`, `src/asql-guide.ts`,
`src/api-overview.ts`), also run:

```bash
npm run docs
```

which regenerates `docs/`. A test fails if the checked-in copies drift from what the server serves.

## Good first contributions

- **A missing domain.** `src/domains.ts` maps a friendly name to a base class and a preferred column
  list. Adding one is a few lines plus a test.
- **A guide correction.** If a guide says something that is not true on your instance, that is a
  genuine bug - the guides are what an assistant reasons from.
- **A failing case.** Open an issue with the exact request path and the exact response body. That is
  often the only way we learn an operation behaves differently elsewhere.

## Reporting a bug well

Include:

- What you asked the assistant to do, and which tool and action it called.
- The **exact request** (path plus query string) and the **exact response body**.
- Your Matrix42 version, and which modules are installed if it is relevant.
- Whether writes were enabled.

Please **redact tokens, hostnames and any personal data** before pasting. An API token in a public
issue must be treated as compromised and rotated.

## Testing against a real instance

Unit tests need no instance. The smoke scripts do:

```bash
M42_HOST=https://matrix42.example.com M42_API_TOKEN=... node scripts/smoke.mjs
M42_HOST=... M42_API_TOKEN=... node scripts/service-desk-smoke.mjs
```

`service-desk-smoke.mjs` confines its writes to a single ticket it creates itself and closes at the
end. **Never point a write-enabled smoke run at production.**

## Style

- TypeScript strict, no `any`, explicit return types on exported functions.
- A one-line comment at the top of every file: path and purpose.
- Comments explain *why*, not *what*. If a value was established by probing a live instance, say so;
  that is the kind of knowledge that is expensive to rediscover.
- Tests cover the happy path, the error path and the edge case. Assert on the request that was
  built, not just that a call happened.

## Code of conduct

Be decent to each other. Assume good faith, keep criticism about the code, and remember that most
people here are debugging a production system on a bad day.
