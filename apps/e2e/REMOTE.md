# Remote E2E mode

The Playwright suite under `apps/e2e/` supports two execution targets, selected
via the `E2E_TARGET` env var:

| Mode              | When                      | What runs                                                                                                                             |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `local` (default) | Developer laptop, default | Spins up the API via `webServer`, runs `globalSetup` (Prisma migrate + tenant seed), points specs at `http://localhost:3001`.         |
| `remote`          | Staging E2E gate (CI)     | No `webServer`, no `globalSetup`. Hits the API at `E2E_API_BASE_URL` and excludes specs tagged `@local-only` (DB-seeded / auth-only). |

## Running remote mode locally (rare)

```bash
E2E_TARGET=remote \
E2E_API_BASE_URL=https://staging-api.example.com \
WEB_URL=https://staging.example.com \
npm run e2e --workspace=@pegasus/e2e
```

## Required env vars (remote mode)

| Var                            | Required         | Used by                                                                                                                               |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_API_BASE_URL`             | yes              | `playwright.config.ts` (also mirrored into `API_BASE_URL` for the `apiFetch` fixture).                                                |
| `WEB_URL`                      | yes              | `tests/browser/landing.spec.ts` (skips if unset).                                                                                     |
| `E2E_COGNITO_USER_POOL_ID`     | reserved         | Future authenticated tests; currently unused.                                                                                         |
| `E2E_COGNITO_CLIENT_ID`        | reserved         | Mobile-app client; reserved for future driver-flow tests.                                                                             |
| `E2E_COGNITO_TENANT_CLIENT_ID` | yes (auth specs) | `fixtures/cognito.ts` — tenant app client used to mint the admin ID token.                                                            |
| `E2E_STAGING_ADMIN_USERNAME`   | yes (auth specs) | `fixtures/cognito.ts` — stable staging admin (`e2e-admin@pegasus-test.invalid`).                                                      |
| `E2E_STAGING_ADMIN_PASSWORD`   | yes (auth specs) | `fixtures/cognito.ts` — permanent password set via `cognito-idp:admin-set-user-password`. GitHub secret on the `staging` environment. |
| `E2E_STAGING_TENANT_ID`        | yes (auth specs) | `fixtures/index.ts` — sent as `x-tenant-id` on authenticated requests.                                                                |

When any of the four `auth specs` vars are missing on a remote run, the
authenticated specs (`tests/api/authz-smoke.spec.ts`) skip cleanly so the rest
of the gate still runs — the deploy workflow is the only environment expected
to have all four set.

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
- `tests/api/authz-smoke.spec.ts` — authenticated AVP smoke. Mints an ID
  token for the staging E2E admin (`E2E_STAGING_ADMIN_USERNAME`) via
  `USER_PASSWORD_AUTH` against the tenant app client, then verifies:
  1. `GET /api/v1/me/permissions` returns `tenant_admin` with
     `quote:create` (proves the AVP path is wired and answering).
  2. `POST /api/v1/users/invite` is allowed (200/201/409). 401/403
     would indicate either a token problem or that AVP rejected the call.

  The spec uses a reserved invite target
  (`e2e-invite-target@pegasus-test.invalid`) so the second run yields a
  409 by design rather than unbounded-growing `tenant_users`.

  **Coverage limit.** This gate proves AVP is _answering correctly for the
  seeded admin_. It does NOT prove that every tenant's persona policies
  uploaded cleanly during provisioning; that stronger guarantee requires
  per-tenant sampling, which is out of scope.

Everything else is `@local-only`. Expanding the gate to richer authenticated
flows (browser login, tenant SSO) is a separate plan.

## How `health.spec.ts` stays unskipped

`health.spec.ts` skips when `E2E_SKIP=true`, which is set by `global-setup.ts`
when local Postgres is unreachable. In remote mode `globalSetup` doesn't run,
so `E2E_SKIP` stays unset and the tests run normally against the deployed API.
