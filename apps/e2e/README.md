# `apps/e2e` — Playwright E2E Suite

Front door for the e2e suite. One suite, three execution targets, selected via
`E2E_TARGET`.

## Execution modes

| Mode              | When                    | What runs                                                                                                                                                                                    |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local` (default) | Developer laptop, PR CI | Spins up the API via `webServer`, runs `globalSetup` (Prisma migrate + tenant seed), points specs at `http://localhost:3001`.                                                                |
| `remote`          | Staging E2E gate (CI)   | No `webServer`, no `globalSetup`. Hits the API at `E2E_API_BASE_URL` and excludes specs tagged `@local-only` (DB-seeded / auth-only). Contract: **[REMOTE.md](./REMOTE.md)**.                |
| `qa`              | On-demand / nightly     | No `webServer`, no `globalSetup`. Real Cognito login → the `/driver-planning` (longhaul) browser + API suite against a QA tenant with a live on-prem tunnel. Contract: **[QA.md](./QA.md)**. |

## Scripts

| Command (from repo root) | Mode     | Notes                                                                                         |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `npm run e2e`            | `local`  | Needs local Postgres (global-setup starts Docker Compose if `pg_isready` fails).              |
| `npm run e2e:remote`     | `remote` | Requires `E2E_API_BASE_URL` (+ `WEB_URL` and the auth vars for the full set) — see REMOTE.md. |
| `npm run e2e:qa`         | `qa`     | Requires the `QA_*` vars — see QA.md.                                                         |

From `apps/e2e/` directly: `npm run e2e` (same modes via `E2E_TARGET=...`) and
`npm run install:browsers` (one-time Chromium install).

Env vars come from the CLI, `.env.test.local` (gitignored, per-dev secrets —
wins), then `.env.test` (tracked local defaults). See `.env.test.example` and
the loader at the top of `playwright.config.ts`.

## Spec layout

- `tests/api/**` — HTTP-level acceptance specs (no browser).
- `tests/browser/**` — browser specs; `tests/browser/longhaul/**` runs only
  under `E2E_TARGET=qa` (page objects in `tests/browser/longhaul/pages/`).

## Tag contract

- `@local-only` — spec needs `globalSetup` DB seeding, `SKIP_AUTH=true`, or
  other local-only infra. Remote/qa modes filter these via `grepInvert`.
- `@qa-mutating` — qa-mode spec that writes to the on-prem MSSQL DB; re-seed
  the QA planning DB before a full run. Skip with `--grep-invert "@qa-mutating"`.

Full tagging rules: [REMOTE.md](./REMOTE.md).

## CI silent-skip guard

Both CI runs (`ci.yml` e2e job, `deploy.yml` `e2e-staging` job) run Playwright
with a JSON reporter and fail if fewer than `E2E_MIN_EXECUTED_TESTS` tests
actually executed (passed/flaky, i.e. not skipped) — floors are `30` (CI) and
`8` (staging gate), set as env vars at the top of each job. This catches the
`E2E_SKIP` / missing-env false-positive class where the suite "passes" by
skipping everything. If you add or remove specs and the guard fires, bump the
floor in the workflow — don't delete the guard.
