# Plan — on-prem pegII API `/health` connectivity check (admin diagnose + tenant self-serve)

## Context

The pegII on-prem domain API used to be **this repo's own** on-prem server. It was
retired; a **separate team** now runs the pegII API on-prem at **port `65274`**
(`http`), exposing an open (no-auth) health endpoint **`GET /health`** that returns
**`{"status":"healthy"}`**.

Two surfaces reference the old/retired server and need to point at the new one:

1. **Admin-web on-prem connectivity check** — the VPN **Diagnose** panel
   (`apps/admin-web/src/components/TenantVpnSection.tsx` → API
   `apps/api/src/handlers/admin/vpn-diagnose.ts`). Its end-to-end probe
   (`checkTcpConnect`, check id `tcp_connect`) currently hits
   `http://<overlayIp>:3000/api/v1/longhaul/version` — a decommissioned on-prem
   longhaul endpoint. **Repurpose** it to probe the new pegII `/health` on `:65274`.

2. **Tenant self-serve health check** — a tenant admin can already test the
   **Legacy Database Connection** ("Run diagnostic" →
   `POST /api/v1/settings/mssql/test`) from
   `apps/tenant-web/src/routes/settings.developer.tsx`. The **pegII** equivalent
   endpoint (`POST /api/v1/settings/pegii/test`) already exists and is tested, but
   (a) has **no tenant-web UI**, and (b) calls `PegiiApiClient.get('/health')`,
   which requires a `{ data }` envelope and would reject the new server's
   `{"status":"healthy"}` body with `BAD_ENVELOPE`.

### Decisions (confirmed with user)

- Admin check: **repurpose** the single on-prem-service probe (drop the dead
  longhaul probe).
- Scheme: **http**.
- `/health` is **open / no auth** (do not send the bearer credential; a missing
  credential must not block the health check).

## Config: point pegII at the real server (single source of truth)

The pegII base URL is resolved by `resolvePegiiOverlayTarget()`
(`apps/api/src/lib/pegii-overlay-target.ts`): `Tenant.pegiiApiBaseUrl` →
`PEGII_API_TUNNEL_BASE_OVERRIDE` → `http(s)://10.200.<o1>.<o2>:<port>` from
`PEGII_API_TUNNEL_SCHEME`/`PEGII_API_TUNNEL_PORT`.

- `packages/infra/lib/stacks/api-stack.ts` (~L825): change
  `PEGII_API_TUNNEL_PORT` `'8443'` → `'65274'`; add
  `PEGII_API_TUNNEL_SCHEME` `'http'`.
- `apps/api/src/lib/pegii-overlay-target.ts`: update code defaults to match the
  now-known reality — scheme default `'http'`, port default `'65274'`. Update
  `pegii-overlay-target.test.ts` expectations.
- Update infra snapshot/assertion tests in `packages/infra` if they pin the env.

This aligns the tenant test, the admin diagnose probe, and the customer-reads
pegII client on the same real server (the customerSource=pegII integration is
flag-gated/inert, so correcting the port/scheme is low risk).

## Part 1 — Admin diagnose: repurpose `tcp_connect` → pegII `/health`

File: `apps/api/src/handlers/admin/vpn-diagnose.ts`

- Rename the check to `pegii_health`, label e.g. `"Cloud → on-prem pegII API /health"`.
- Resolve the pegII base via `resolvePegiiOverlayTarget(db, tenantId)` (reuse the
  same resolver the tenant test uses → no drift; honors per-tenant base override).
  It returns `ok:true` here because the probe only runs when the peer is ACTIVE.
- `tunnelFetch(`${base}/health`, { method: 'GET', timeoutMs: 5000 })` — **no
  Authorization header** (open endpoint).
- Pass on HTTP 2xx (evidence: parsed `status`); fail on non-2xx / `TunnelError`.
  Drop the old `403-as-pass` special case (no auth now) and the longhaul port
  constant `TENANT_OVERLAY_PORT`/`/api/v1/longhaul/version` URL.
- Update `apps/api/src/handlers/admin/vpn-diagnose.test.ts` for the new check
  id/label/URL and the resolver dependency.
- `apps/admin-web/src/api/vpn.ts` types are `id: string`-based, so no type change
  needed; the panel renders whatever checks come back. Verify label/id render.

## Part 2 — pegII health probe tolerant of `{"status":"healthy"}` + tenant UI

### API — health probe that does not require the `{ data }` envelope

File: `apps/api/src/lib/pegii-api-client.ts`

- Add a `getHealth(): Promise<{ status?: string } & Record<string, unknown>>`
  method to `PegiiApiClient` (and the factory). It raw-`tunnelFetch`es `GET
/health` with **no Authorization header**, parses JSON, throws `PegiiApiError`
  on non-2xx (`PEGII_API_HTTP_ERROR`) or non-JSON (`PEGII_API_BAD_ENVELOPE`), but
  **does not** require a `data` field. Leave `.get<T>()` unchanged (customer reads
  still expect `{ data }`).
- Tests in `apps/api/src/lib/__tests__/pegii-api-client.test.ts`: `{"status":
"healthy"}` 2xx → returns it; non-2xx → `PEGII_API_HTTP_ERROR`; non-JSON →
  `PEGII_API_BAD_ENVELOPE`; asserts no Authorization header sent.

File: `apps/api/src/handlers/settings-pegii.ts`

- `POST /pegii/test`: call `client.getHealth()` instead of `client.get('/health')`.
  Treat 2xx with `status === 'healthy'` (or `status` absent) as `OK`; a present
  `status !== 'healthy'` → `HTTP_ERROR` with a "degraded" detail. Keep the
  `{ ok, code, detail, elapsedMs }` shape and `Actions.ReadSettings` gate.
- Update `apps/api/src/handlers/settings-pegii.test.ts` accordingly (OK on
  `{"status":"healthy"}`; no more BAD_ENVELOPE for the health body).

### Tenant-web UI — mirror the DB "Run diagnostic"

- `apps/tenant-web/src/api/settings.ts`: add `PegiiTestCode`, `PegiiTestResult`,
  and `testPegiiConnection()` → `apiFetch<PegiiTestResult>(
'/api/v1/settings/pegii/test', { method: 'POST' })`.
- `apps/tenant-web/src/api/queries/settings.ts`: add `useTestPegiiConnection()`
  (plain `useMutation`, mirrors `useTestMssqlConnection`).
- `apps/tenant-web/src/routes/settings.developer.tsx`: add a **"pegII API
  Connection"** card (or a sibling section) modeled on `MssqlSettingsSection`'s
  diagnostic sub-part: a "Check health" button (`Stethoscope`/`Loader2`), the
  same `handleRunDiagnostic`/`testResult` state pattern, and a green/red result
  banner showing `detail`. Scope: health check only (no pegII config editing).
- Add a light test mirroring the existing settings query/component test pattern
  (e.g. `testPegiiConnection` / the new hook).

## Verification

- `npm run typecheck`, `npm test` (domain/api/infra/tenant-web), `npm run lint`.
- API unit tests: pegii-api-client, settings-pegii, pegii-overlay-target,
  vpn-diagnose all green.
- Manually confirm the admin Diagnose panel renders the new `pegii_health` row and
  the tenant developer settings page renders + fires the pegII health button
  (via `/run` or component test — no live tunnel needed; mock the probe).
- No Prisma migration (no schema change).

## Out of scope

- pegII API **config editing** UI in tenant-web (PATCH `/pegii` already exists;
  not requested).
- Changing the customerSource read integration behavior beyond the corrected
  port/scheme.
