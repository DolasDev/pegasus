# QA E2E mode (`E2E_TARGET=qa`) — the `/driver-planning` (longhaul) suite

A browser + API E2E suite that exercises the ported legacy "longhaul" planning
module (`/driver-planning/*` in tenant-web, backed by `/api/v1/onprem/longhaul/*`)
against a **real QA tenant** with a **live WireGuard tunnel** to the on-prem
**Dolios** server and a **known-good (disposable) planning database**.

It is a third Playwright target alongside `local` and `remote` (see `REMOTE.md`):

| Mode     | `webServer` / `globalSetup` | What runs                                                                                                 |
| -------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `local`  | yes                         | API spun up locally, Prisma migrate + tenant seed, specs hit `localhost:3001`.                            |
| `remote` | no                          | Hits `E2E_API_BASE_URL`; excludes `@local-only`. The staging deploy gate.                                 |
| `qa`     | no                          | Real Cognito login → `tests/browser/longhaul/**` + `tests/api/longhaul-qa.spec.ts` against the QA tenant. |

## What it covers

Derived from the legacy app's behaviour (`../longhaul`). See the scenario
catalog in `plans/.../i-ve-placed-the-original-functional-cocke.md`.

- **`@smoke`** — the on-prem version-ping canary (tunnel → Dolios → MSSQL alive),
  the four `/driver-planning` tabs render, lists load from the on-prem DB. The
  whole suite `test.skip`s if the canary is unhealthy (the on-prem error is
  surfaced in the run output).
- **Availability tab** — driver table, name filter, inline-edit confirmed
  date/location/notes with a persist-after-reload check (`@qa-mutating`).
- **Shipments / Planning / Trips / Trip-detail** — smoke checks run today;
  the interaction-heavy flows (FilterTabs, PendingTrips trip-builder, TripCard,
  ActivityGantt, Notes, status dropdown) are `test.fixme`'d pending the Phase A
  exploratory pass that confirms selectors / adds `data-testid`s to the ported
  components.
- **`tests/api/longhaul-qa.spec.ts`** — HTTP-level checks of the on-prem bridge:
  GET smoke (`/version`, `/users/me`, `/shipments`, `/trips`, `/trip-statuses`,
  `/drivers`, `/driver-planning`, `/filter-options`, `/shipment-filters`),
  negatives (404 / 403), and write round-trips (`@qa-mutating`).

`@qa-mutating` specs write to the on-prem MSSQL DB. The QA planning DB is
disposable — **re-seed it from the known-good snapshot before a full run**; the
read-only subset (`--grep-invert @qa-mutating`) can run any time.

## Prerequisites (provisioned out-of-band)

1. A **QA tenant** in the QA Cognito user pool with:
   - a **test user** (`QA_USER_USERNAME` / `QA_USER_PASSWORD`) — permanent
     password (`AdminSetUserPassword --permanent`), **MFA disabled**;
   - that user's `TenantUser.legacyWindowsUsername` mapped to a valid Dolios
     user (the longhaul proxy forwards it as `X-Windows-User` — without a valid
     mapping the on-prem middleware returns 403);
   - the user able to reach `/driver-planning` (any tenant role works — the
     module isn't AVP-gated yet).
2. A **WireGuard tunnel** for that tenant up and healthy (the cloud Lambda
   proxies `/api/v1/onprem/longhaul/*` through it to the on-prem server).
3. The on-prem **planning MSSQL database** loaded with the known-good snapshot.

## Env vars

| Var                | Required | Used by                                                             |
| ------------------ | -------- | ------------------------------------------------------------------- |
| `QA_WEB_URL`       | yes      | `playwright.config.ts` (`baseURL`), the login helper, page objects. |
| `QA_API_BASE_URL`  | yes      | mirrored into `API_BASE_URL`; `qaApiFetch` + the `qa-api` spec.     |
| `QA_TENANT_ID`     | yes      | sent as `x-tenant-id` on `qaApiFetch` requests.                     |
| `QA_USER_USERNAME` | yes      | login email / Cognito username (`fixtures/hosted-ui-login.ts`).     |
| `QA_USER_PASSWORD` | yes      | login password — store as a secret.                                 |
| `QA_TENANT_NAME`   | no       | disambiguates the tenant picker when the email maps to >1 tenant.   |

For local runs put these in **`apps/e2e/.env.test.local`** (gitignored — see
`apps/e2e/.env.test.example` for the full key list), or just pass them inline on
the command line. For CI they live in the **`qa` GitHub Environment**
(`QA_USER_PASSWORD` as a secret, the rest as environment variables) — see
`.github/workflows/e2e-qa-longhaul.yml`.

## How it authenticates

There is no token injection — the `qa-setup` project drives the real tenant-web
`/login` UI (`fixtures/hosted-ui-login.ts`): enter email → (tenant picker, if
needed) → "Sign in with password" → password → land on `/dashboard`. It then
captures the browser session (cookies + `sessionStorage['pegasus.session']`,
which Playwright's `storageState` does _not_ persist) and the Cognito ID token to
`apps/e2e/playwright/.auth/qa-session.json`. The `qa-browser` and `qa-api`
projects depend on `qa-setup` and re-inject that session via `fixtures/qa.ts`.

If the QA tenant uses a **federated IdP** instead of Cognito-native users, the
login helper currently throws — add the IdP-specific form handling at the
`select-provider` step (it's a clearly-marked TODO in `hosted-ui-login.ts`).

## Running it

```
E2E_TARGET=qa QA_WEB_URL=https://pegasus-qa.dolas.dev QA_API_BASE_URL=https://api-qa.dolas.dev QA_TENANT_ID=<uuid> QA_USER_USERNAME=<email> QA_USER_PASSWORD=<pw> npm run e2e --workspace=@pegasus/e2e
```

Useful slices:

- Smoke + login only: `... -- --grep "@smoke"`
- Read-only (safe against the current DB): `... -- --grep-invert "@qa-mutating"`
- API layer only: `... -- --project=qa-api`
- Browser layer only: `... -- --project=qa-browser`

In CI: the **E2E — QA longhaul** workflow (`workflow_dispatch` + nightly).

## Phase A → Phase B

Per the approved plan, the first pass is exploratory (Claude Code web browsing
against the live QA tenant) to confirm the login flow shape, the ported
components' real DOM, and fixture trip/shipment/driver ids — then the
`test.fixme`'d specs get filled in and `data-testid`s added to the ported
components where role/text proves brittle.
