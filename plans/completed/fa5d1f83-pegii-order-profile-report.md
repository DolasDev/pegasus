# pegII report bridge — order-profile PDF on the Operations shipment pane

**Type / slug:** `feat` / `pegii-order-profile-report`

## Goal

Bridge the pegII team's already-shipped on-prem report endpoint into the cloud API
and surface it as a **"View Trip Sheet"** link on the tenant-web Operations
(driver-planning) shipment detail pane. This is the stepping stone; the mobile
shipment-screen tab is a **separate follow-up workstream** that reuses the same
cloud route.

## Upstream contract (owned by the pegII team, already built)

```
GET {pegiiBase}/api/v1/pegii/reports/{reportType}/{id}
  default   → { data: { reportType, id, fileName, contentType: "application/pdf", contentBase64 },
                error, code, correlationId }
  ?format=pdf → raw application/pdf stream + Content-Disposition
```

`reportType` = `order-profile`, `id` = the order number (`shipment.order_num`,
the same id the Order Number link and the mobile shipment screen already key on).

## Decisions (stated, not assumed silently)

1. **Session surface, not m2m.** `pegiiRuntimeHandler` is mounted on `m2mV1` and
   authorizes Cognito sessions _away_ (403) — tenant-web is a session caller.
   Precedent for a session-surface pegII read is `v1.get('/dashboard/pegii', …)`.
   SDK / m2m / MCP / OpenAPI exposure is **deferred by decision**, not forgotten
   (see Follow-ups). Per the repo's SDK rule this is a conscious deferral of a
   read that no workflow author has asked for yet.
2. **Cloud path is `/api/v1/pegii-reports/:reportType/:id`, not `/api/v1/pegii/…`.**
   `m2mV1.route('/pegii', pegiiRuntimeHandler)` registers `dualAuthMiddleware` at
   `/pegii/*` on the shared `/api/v1` prefix; a session route nested under the same
   prefix would run that middleware and get confusing auth semantics. A distinct
   prefix keeps the two surfaces from interleaving. The on-prem path is mirrored
   verbatim _inside_ the gateway.
3. **Always pull the base64 envelope from on-prem.** `pegii-api-client` speaks the
   JSON envelope over `tunnelFetch`; it has no binary-stream mode. `?format=pdf`
   on **our** route is served by decoding base64 in the handler. We never call
   upstream with `?format=pdf`.
4. **Auth gate = authenticated tenant user** (`tenantMiddleware`), matching every
   other `/onprem/longhaul/*` Operations endpoint, which carry no
   `requirePermission`. Same blast radius as the shipment data already on that
   screen, tenant-scoped by the per-tenant pegII overlay target. A dedicated
   `ReadPegiiReport` Cedar action is a deliberate non-goal here (`ReadOrder` is a
   workflow-runtime/integration action granted to no human persona, so reusing it
   would 403 every real user).
5. **`reportType` is a closed allowlist** (`order-profile` only) — not a free
   passthrough, so this can't be used to probe arbitrary on-prem report names.

## Implementation

### 1. API — gateway (TDD)

- `apps/api/src/gateways/report.gateway.ts` — `ReportGateway` interface:
  `fetchReport(reportType, id): Promise<ReportRecord | null>`, where
  `ReportRecord = { reportType, id, fileName, contentType, contentBase64 }`.
- `apps/api/src/gateways/pegii/pegii-report.dto.ts` + `pegii-report.mapper.ts` —
  anti-corruption mapping/validation of the upstream payload (mirrors the
  order/customer/salesman dto+mapper pairs). Malformed payload →
  `PegiiApiError('PEGII_API_BAD_ENVELOPE')`.
- `apps/api/src/gateways/pegii-report.gateway.ts` — composes
  `createPegiiApiClient` with the mapper; path
  `/api/v1/pegii/reports/${encodeURIComponent(reportType)}/${encodeURIComponent(id)}`;
  upstream 404 → `null` via `isPegiiNotFound`.
- `apps/api/src/gateways/report-gateway.factory.ts` — `resolveReportGateway(db, tenantId)`
  via `resolvePegiiOverlayTarget`, throwing `PEGII_API_NOT_CONFIGURED` on an
  unreachable tenant (byte-for-byte the `resolveOrderGateway` shape).
- Tests: `gateways/__tests__/pegii-report.gateway.test.ts` +
  `gateways/pegii/__tests__/pegii-report.mapper.test.ts`, using the existing
  injected-stub-client seam.

### 2. API — handler (TDD)

`apps/api/src/handlers/pegii-reports.ts`, a Hono sub-app mounted
`v1.route('/pegii-reports', pegiiReportsHandler)`:

- `GET /:reportType/:id`
  - `reportType` — Zod enum `['order-profile']`; anything else → 400
    `UNSUPPORTED_REPORT_TYPE`.
  - `id` — existing `IDENT_RE` (`/^[A-Za-z0-9._:-]{1,128}$/`) → 400 on mismatch.
  - `?format=pdf` → `c.body(bytes)` with `Content-Type: application/pdf` and
    `Content-Disposition: inline; filename="<fileName>"` (filename sanitized).
  - default → `{ data: { reportType, id, fileName, contentType, contentBase64 } }`.
  - not found upstream → 404 `REPORT_NOT_FOUND`.
- **Size guard.** API Gateway/Lambda cap responses at 6 MB and base64 inflates by
  ~33%. A `contentBase64` over a `MAX_REPORT_BASE64_BYTES` threshold (4.5 MB,
  module const) returns 502 `REPORT_TOO_LARGE` with a legible message instead of
  a truncated/failed invoke.
- Router-scoped `onError` → `pegiiApiErrorToHttp` (the `pegii-runtime.ts`
  boundary pattern: legible 502/503/404, re-throw anything else).
- Tests: `handlers/pegii-reports.test.ts` — envelope shape, `?format=pdf` bytes +
  headers, bad reportType, bad id, upstream 404, not-configured → 503, oversize.
- If the OpenAPI coverage test flags the route, document it in
  `lib/openapi-spec.ts` (it currently gates m2m GETs; verify, don't assume).

### 3. tenant-web — fetch + open (TDD)

- `apps/tenant-web/src/api/queries/pegii-reports.ts` —
  `fetchPegiiReport(reportType, id)` via `apiFetch` (unwraps `{ data }`, throws
  `ApiError`). No raw-response helper needed because we read the base64 envelope.
- `apps/tenant-web/src/utils/open-base64-pdf.ts` — base64 → `Uint8Array` → `Blob`
  → `createObjectURL` → `window.open`, revoking the object URL afterward. Unit
  tested. A plain `<a href="…?format=pdf">` cannot work: the API requires a
  bearer token the browser won't attach to a navigation.
- `features/driver-planning/containers/ShipmentDetail/index.tsx` — a
  **"View Trip Sheet"** action beside the Order Number / Reg Number rows, styled
  with the existing `clickableStyles.clickable` (same reuse note as the Atlas
  anchor), with a pending state and `notifyError` on failure (the module's
  existing snackbar pattern). Hidden when `shipment.order_num` is absent.
- Tests: util test + a ShipmentDetail render/click test asserting the fetch is
  issued with the row's `order_num` and that a failure surfaces the snackbar
  rather than error-boundarying.

### 4. Verify

- `npm test`, `npm run typecheck`, `npm run lint` green.
- Coverage floors re-pinned if vitest raises them.
- Note in the PR: the link 502s legibly against any tenant whose pegII overlay
  target isn't configured, and depends on the pegII team's endpoint being live on
  that tenant's on-prem host.

## Follow-ups (explicitly out of scope for this PR)

1. **Mobile shipment-screen tab** — `apps/mobile/app/shipment/[orderNum].tsx`
   already has a `'details' | 'documents'` tab switch and a `DocumentsTab`; add a
   third tab reusing this same cloud route. Separate worktree/PR.
2. **SDK / m2m exposure** — if a workflow author needs report pulls, add the
   `/api/v1/pegii/reports` m2m route with a Cedar action, an SDK client method,
   OpenAPI doc, MCP resource and CLI help, then release the SDK.
3. **Additional report types** — extend the Zod enum; the allowlist is the only
   place that needs to change.

## Outcome (shipped)

All four implementation sections landed as planned, plus one addition.

**API**

- `gateways/report.gateway.ts` (`ReportGateway` / `ReportRecord`),
  `gateways/pegii/pegii-report.dto.ts` + `pegii-report.mapper.ts`,
  `gateways/pegii-report.gateway.ts`, `gateways/report-gateway.factory.ts`.
- `handlers/pegii-reports.ts`, mounted `v1.route('/pegii-reports', …)`.
- The mapper validates the base64 **alphabet**, not just presence. `Buffer.from(s,
'base64')` silently discards illegal characters, so an HTML error page or a
  truncated payload would have decoded to a plausible-looking corrupt PDF and
  reached the user as a broken download. It is a 502 `PEGII_SOURCE_BAD_RESPONSE`
  instead.
- `?format=pdf` copies out of the pooled Buffer before handing bytes to Hono —
  `buf.buffer` unsliced would emit neighbouring pool bytes.

**tenant-web**

- `api/queries/pegii-reports.ts`, `lib/open-base64-pdf.ts` (object URL revoked on
  a 60s timer, not synchronously — same-tick revocation races the new tab's load
  in Chrome), and the **View Trip Sheet** row in `ShipmentDetail`.
- A blocked popup is reported to the user rather than failing silently.

**Addition not in the plan:** `apps/api/src/__tests__/route-prefix-middleware-bleed.test.ts`
plus a `dolas/agents/project/GOTCHAS.md` entry. Decision 2 (the `/pegii-reports`
prefix) rested on a claim about Hono's mounting semantics, so it is now an
executable proof: a `use('*')` inside a sub-app mounted at `/pegii` runs for
`/pegii/reports/...` even when that sub-app has no handler for it, and a sibling
prefix isolates. That is the trap the prefix choice avoids, and it would
otherwise have been a comment nobody could check.

**Verification:** `npm test`, `npm run typecheck`, `npm run lint` all green.
`apps/api/vitest.config.ts` coverage floors re-pinned upward by vitest autoUpdate.

**Known live behavior:** the link 502s legibly for any tenant whose pegII overlay
target is unconfigured, and depends on the pegII team's report endpoint being
live on that tenant's on-prem host. Nothing here was exercised against a real
on-prem install.
