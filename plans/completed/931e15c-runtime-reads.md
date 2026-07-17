# Plan: fix the SDK domain-read helpers (P1) — make `vnd_` workflow reads actually reachable

**Problem (verified).** `PegasusClient.list_customers / list_quotes / list_moves / list_invoices / list_inventory / list_events` are documented as "read helpers for use inside workflow activities," and the `workflow_runtime` Cedar persona **already grants** `ReadQuote/ReadMove/ReadInvoice/ReadCustomer/ReadEvent`. But the routes they hit (`/api/v1/{customers,quotes,moves,invoices}`) live only on the Cognito-only `v1` router (`tenantMiddleware`), which rejects `vnd_` keys before they arrive — so every one of these 401s for a real `PegasusClient`. `list_inventory` / `list_events` additionally hit paths that aren't registered at all.

The permission + SDK method exist; only the **wiring** is missing. No Cedar changes needed (→ no AVP fan-out risk).

## Design

**Do NOT mount these at `/api/v1/{customers…}`.** The dual-auth router is matched _before_ the Cognito `v1` router, and `dualAuthMiddleware` falls through to `tenantMiddleware` for a browser token — so a same-path m2m route would **shadow** the existing full CRUD handlers for browser requests (regression). Use a **distinct prefix**, exactly like pegii's `/pegii/{orders,tasks}`.

**New m2m read handler** `apps/api/src/handlers/runtime-reads.ts`, mounted `m2mV1.route('/runtime', runtimeReadsHandler)` (dual-auth), with GET-list routes reusing the SAME repository/query the v1 handlers use, returning the SAME `{data}` shape:

| Route                           | RBAC (already granted to workflow_runtime)                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/runtime/customers` | `ReadCustomer`                                                                                                                                |
| `GET /api/v1/runtime/quotes`    | `ReadQuote`                                                                                                                                   |
| `GET /api/v1/runtime/moves`     | `ReadMove` (NOT `ListMoves` — the persona grants `ReadMove`, not `ListMoves`; using it keeps this on the existing grant with no Cedar change) |
| `GET /api/v1/runtime/invoices`  | `ReadInvoice`                                                                                                                                 |

Query params (paging/filter) pass through to the same list functions. A Cognito browser can also call these (dual-auth), but the browser SPA keeps using the existing `/api/v1/*` handlers — no shadowing either way.

**`list_events`** — the events queue already has an m2m route `GET /api/v1/events/:eventType` (gated `ReadEvent`). The SDK's `list_events()` hits bare `/events` (not a route). Fix the SDK: `list_events(event_type)` → `GET /api/v1/events/{event_type}`. (Kept on its existing handler; no new route.)

**`list_inventory`** — REMOVE. Inventory has **no** `ReadInventory` action, is **not** granted to `workflow_runtime` (the persona deliberately omits it), and is nested under moves (`/moves/:moveId/inventory`). Wiring it would require a new Cedar action + grant (fan-out) for an entity the persona intentionally excludes. Deprecate/remove the method rather than invent a grant; document as a known non-capability.

## Changes

1. **API** — `handlers/runtime-reads.ts` (new): 4 GET routes, dual-auth + `requirePermission`, reusing the v1 list logic (extract a shared `listX(db, tenantId, params)` if the current code is inline in the route). Register in `app.ts` on `m2mV1`. Tests (`runtime-reads.test.ts`): each route returns data for a `vnd_` principal with the grant, 403 without, tenant-scoped.
2. **SDK** — repoint `list_customers/quotes/moves/invoices` to `/api/v1/runtime/*`; change `list_events` to require `event_type` → `/events/{event_type}`; **remove** `list_inventory`. Update docstrings (drop the "thin helper" wording, state the runtime persona + path). Keep them in the testing-harness `_READS` set (`testing/__init__.py`). SDK **0.23.0** (removes `list_inventory` → minor with a documented breaking note; the methods were non-functional, so no real caller breaks).
3. **Docs** — README: add a short "Reading operational entities inside a workflow" subsection (the 4 lists + `list_events(event_type)`), and the persona/grant note. MCP `reference/api` auto-updates from the docstrings. OpenAPI: add the 4 `/runtime/*` GETs (they're SDK-relevant).
4. **CHANGELOG** + version bump.

## Out of scope

- P2 items (cancel/retry/fork accessors, live schema getters) — separate follow-up.
- Restoring inventory reads — would need a deliberate `ReadInventory` action + persona grant; file if a workflow ever needs it.

## Acceptance

A `PegasusClient` built from `from_runtime` (a `vnd_` workflow_runtime key) can call `list_customers()/list_quotes()/list_moves()/list_invoices()` and `list_events(event_type)` and get data (not 401/404). `list_inventory` is gone. Browser `/api/v1/customers` behaviour is unchanged. No Cedar policy/action changes → no cross-tenant AVP sync.
