# Remote E2E mode

The Playwright suite under `apps/e2e/` supports two execution targets, selected
via the `E2E_TARGET` env var:

| Mode             | When                     | What runs                                                                                                                            |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `local` (default) | Developer laptop, default | Spins up the API via `webServer`, runs `globalSetup` (Prisma migrate + tenant seed), points specs at `http://localhost:3001`.        |
| `remote`         | Staging E2E gate (CI)    | No `webServer`, no `globalSetup`. Hits the API at `E2E_API_BASE_URL` and excludes specs tagged `@local-only` (DB-seeded / auth-only). |

## Running remote mode locally (rare)

```bash
E2E_TARGET=remote \
E2E_API_BASE_URL=https://staging-api.example.com \
WEB_URL=https://staging.example.com \
npm run e2e --workspace=@pegasus/e2e
```

## Required env vars (remote mode)

| Var                           | Required | Used by                                                                                       |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `E2E_API_BASE_URL`            | yes      | `playwright.config.ts` (also mirrored into `API_BASE_URL` for the `apiFetch` fixture).         |
| `WEB_URL`                     | yes      | `tests/browser/landing.spec.ts` (skips if unset).                                              |
| `E2E_COGNITO_USER_POOL_ID`    | reserved | Future authenticated tests; currently unused.                                                  |
| `E2E_COGNITO_CLIENT_ID`       | reserved | Future authenticated tests; currently unused.                                                  |

## `@local-only` tagging contract

Tag a `test.describe(...)` block with `@local-only` (or use `test.skip` guarded
on `process.env['E2E_TARGET'] === 'remote'`) when the spec requires:

- DB seeding via `globalSetup` (e.g. tenant fixtures, ApiClient, VpnPeer).
- `SKIP_AUTH=true` on the API server (i.e. it bypasses real Cognito).
- Any other state assumed to be present only on the local Postgres + API process.

The remote config sets `grepInvert: /@local-only/`, so tagged specs are filtered
out of the staging gate. Untagged specs run against the deployed staging stack.

## What the staging gate runs today

Intentionally narrow:

- `tests/api/health.spec.ts` — unauthenticated health + DB depth checks.
- `tests/browser/landing.spec.ts` — landing page loads at `WEB_URL`.

Everything else is `@local-only`. Expanding the gate to authenticated, seeded
flows is a separate plan; the current gate is the smallest useful smoke test
that's safe to run against shared staging.

## How `health.spec.ts` stays unskipped

`health.spec.ts` skips when `E2E_SKIP=true`, which is set by `global-setup.ts`
when local Postgres is unreachable. In remote mode `globalSetup` doesn't run,
so `E2E_SKIP` stays unset and the tests run normally against the deployed API.
