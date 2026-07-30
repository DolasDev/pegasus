# Fix sdk-feedback 0029 — pegII order bridge "undefined" stub + native payload for dry-run

## Context

`sdk-feedback/0029` filed against SDK 0.26.0. Two related gaps, both hit dry-running
the published Weichert (`demo_partner`) integration against real order ids:

- **A (bug).** `GET /api/v1/pegii/orders/:id` returns a **200** carrying an
  `"undefined"`-filled stub (`id:"undefined"`, `orderNumber:"SO-undefined"`,
  `customerName:null`, epoch dates) for orders that demonstrably have full data.
  Root cause: the mapper/DTO read **guessed** PascalCase keys (`SaleId`,
  `OrderNumber`, `CustomerName`, `ScheduledDate`, `CreatedDate`) that do **not**
  exist on the real serialized pegII payload. The real native shape (confirmed by
  the demo_partner corpus + transform, and the feedback's pasted record) is
  `Id`, `Survey.SerivceStatus` (pegII's typo, preserved), `Survey.ShipperName`,
  `InvolvedParties.{ShipperEmployer,Coordinator}.Identity.Description`,
  `KeyMoveDates.{Survey.Planned, Pack.Actual, Load.Actual, Delivery.Actual}`,
  `OrderDate`, `ModifiedDate` (the one key that currently resolves → `updatedAt`),
  `Financials.*`, `WarehouseSummary`, `SettlementUniqueInfo`, `DocumentationDates`.
- **B (additive).** No endpoint returns an order's **native** pegII payload, so a
  published integration can't be dry-run against a real order id — every check is
  hand-pasted.

Chosen surface for B (user-approved): **native selector + SDK convenience** — a
`?shape=native` selector on the existing route plus a client-side
`dry_run_integration` that composes `get_order(native)` + `map_from_external`. No
new server route; same `ReadOrder` Cedar gate.

## A — fix the projection (bug fix)

Files: `apps/api/src/gateways/pegii/pegii-order.dto.ts`,
`apps/api/src/gateways/pegii/pegii-order.mapper.ts`, gateway + tests.

1. Rewrite `PegiiOrderDto` to the **real** native serialized shape (nested,
   PascalCase, all optional/nullable, still marked provisional): `Id`,
   `Survey?: {SerivceStatus?, ShipperName?}`, `InvolvedParties?: {ShipperEmployer?,
Coordinator?: {Identity?: {Description?}}}`, `KeyMoveDates?: {Survey?:{Planned?},
Pack?:{Actual?}}`, `OrderDate?`, `ModifiedDate?`.
2. Rewrite `mapPegiiOrderToRecord` to read those keys:
   - `id` ← `Id`
   - `orderNumber` ← `InvolvedParties.ShipperEmployer.Identity.Description` ?? `SO-<Id>`
   - `status` ← `Survey.SerivceStatus` (via existing `mapStatus`)
   - `customerName` ← `Survey.ShipperName` ?? null
   - `scheduledDate` ← `KeyMoveDates.Survey.Planned` ?? null
   - `packingActualDate` ← `KeyMoveDates.Pack.Actual` ?? null
   - `createdAt` ← `OrderDate` ?? epoch
   - `updatedAt` ← `ModifiedDate` ?? epoch
3. **Fail-loud guard (non-negotiable AC):** if no real `Id` resolves
   (`undefined`/blank), `mapPegiiOrderToRecord` returns **null** — the gateway
   returns null → the route yields **404**. NEVER a 200 carrying
   `"undefined"`/`"SO-undefined"`/epoch identity.
4. Update `pegii-order.gateway.test.ts` to the real native keys; add a
   "populated order → real fields" case and a "stub / missing Id → null → 404" case.

## B — native selector + SDK convenience (additive)

- `order.gateway.ts`: add `findOrderNativeById(id): Promise<unknown | null>` to the
  `OrderGateway` interface (raw parsed JSON, no mapping; null on pegII 404).
- `pegii-order.gateway.ts`: implement it — same `client.get` to the serialized
  path, return the raw dto; `isPegiiNotFound` → null.
- `pegii-runtime.ts` route `GET /orders/:orderId`: accept `?shape=native`.
  - `shape=native` → `gateway.findOrderNativeById(id)` → `{data: <raw native>}` (404 when null).
  - default/unset → existing projected `toOrderResponse` path (now fixed).
  - reject any other `shape` value with 400.
- `openapi-spec.ts`: document the `shape` query param (`native`) on `getPegiiOrder`.
- SDK `api.py`:
  - `get_order(order_id, *, shape: str | None = None)`: `shape="native"` →
    `GET .../:id?shape=native`, return raw `data`. Default unchanged.
  - `dry_run_integration(integration_id, order_id, *, shape="native")`:
    `get_order(order_id, shape="native")` → `map_from_external(integration_id, native)`
    → `{canonical, valid, issues, degraded}`. No new Cedar action.
  - Docstrings on both.
- SDK discovery surfaces (per CLAUDE.md): README + `pegasus-workflows` CLAUDE.md +
  MCP `pegasus://reference/*` resources + CLI `--help` if the order surface is
  exposed there. Prefer live introspection where the contract is code.

## Tests

- `apps/api`: gateway unit tests (native keys map correctly; missing-Id → null;
  `findOrderNativeById` returns raw + null-on-404); route integration tests
  (native shape passthrough, default projection, 404 for a stub/missing order,
  400 on bad shape).
- SDK `tests/test_api.py`: `get_order(shape="native")` request shape;
  `dry_run_integration` composes the two calls and returns the map result.

## Out of scope / handoff

- **Live end-to-end validation** on order 490574 against the published
  `demo_partner` config (needs live pegII tunnel + published config) → the 0029
  "Validation log" step; handoff to the pegasus-workflows session.
- **PyPI publish + SDK version tag** → deferred (no publishing from a platform
  session). Bump the in-repo SDK version and record 0029's "SDK version that
  addresses it" in the same PR; the release/publish is a separate handoff.

## Feedback bookkeeping

- Fill 0029 header "SDK version that addresses it", tick the implementable
  acceptance checkboxes, and note in the validation log what remains for live verify.
