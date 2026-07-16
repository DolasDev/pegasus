# fix: pegII bridge returns a legible status when the on-prem source is unreachable

Implements sdk-feedback spec **0018** — `get_order` (and the other pegII-bridge
routes) return a bare `500 INTERNAL_ERROR` when the on-prem pegII source is
firewalled/unreachable, collapsing "upstream down", "no such order", and "genuine
bridge bug" into one opaque 500. Give each its own status.

Spec: `~/repos/pegasus-workflows/sdk-feedback/0018-get-order-bare-500-on-onprem-failure.md`

## Root cause (confirmed by reading the code)

- `GET /api/v1/pegii/orders/:orderId` (`apps/api/src/handlers/pegii-runtime.ts`)
  calls `resolveOrderGateway(...)` → `gateway.findOrderById(id)`.
- The gateway (`gateways/pegii-order.gateway.ts`) maps an **upstream 404 → null**
  (`isPegiiNotFound`) so the handler already returns a real 404 when the source is
  reachable. Every **other** `PegiiApiError` (`PEGII_API_TUNNEL_ERROR`,
  `PEGII_API_NOT_CONFIGURED`, `PEGII_API_BAD_ENVELOPE`, non-404 `PEGII_API_HTTP_ERROR`)
  is **thrown**.
- Nothing on the pegII router catches it, so it propagates to the global
  `app.onError` (`apps/api/src/app.ts:131`), which only knows `DomainError` →
  everything else becomes `500 INTERNAL_ERROR`. That is the bare 500 in the spec.
- The firewall in the spec surfaced as `PEGII_API_TUNNEL_ERROR` (a `TunnelError`
  wrapped by `pegii-api-client.ts`), which is exactly "upstream unreachable".
- `list_orders` is a pure in-memory **stub** (`services/pegii-orders.ts`) that does
  zero I/O and always returns `200 []`, so it "disagreed" with the 500 from
  get_order for the same (down) tenant — AC #5.

## Design (scope: pegII router only — zero blast radius elsewhere)

Handle `PegiiApiError` **on the pegII router**, not in the global `app.onError`.
Rationale: the spec says "on the pegII-bridge endpoints"; `settings-pegii.ts`
already sets the precedent of handling `PegiiApiError` locally; and it keeps the
global handler + the customers `pegii` gateway path untouched (no existing test
asserts 500 for a `PegiiApiError` — the customers 500 tests all throw a generic
`Error`).

### 1. Shared status mapper (next to `PegiiApiError`)

Add to `apps/api/src/lib/pegii-api-client.ts`:

```ts
export interface PegiiHttpError {
  status: 404 | 502 | 503
  code: string
  message: string
}

/** Map a PegiiApiError to a client-facing HTTP status that names the dependency. */
export function pegiiApiErrorToHttp(err: PegiiApiError): PegiiHttpError
```

Mapping:
| PegiiApiError.code | HTTP | body `code` | message (names the dependency) |
| ----------------------------- | ---- | ----------------------- | -------------------------------------------------- |
| `PEGII_API_NOT_CONFIGURED` | 503 | `PEGII_SOURCE_UNAVAILABLE` | "pegII order source is not configured for this tenant" |
| `PEGII_API_TUNNEL_ERROR` | 502 | `PEGII_SOURCE_UNREACHABLE` | "pegII source unreachable" (+ err.message) |
| `PEGII_API_BAD_ENVELOPE` | 502 | `PEGII_SOURCE_BAD_RESPONSE`| "pegII source returned an invalid response" |
| `PEGII_API_HTTP_ERROR` s=404 | 404 | `NOT_FOUND` | "not found" |
| `PEGII_API_HTTP_ERROR` other | 502 | `PEGII_SOURCE_BAD_RESPONSE`| "pegII source returned an error" (+ status) |

500 is thereby **reserved** for genuine bridge bugs (any non-`PegiiApiError`).

### 2. Router-scoped error boundary

In `handlers/pegii-runtime.ts`, add `pegiiRuntimeHandler.onError(...)`:

- `PegiiApiError` → `pegiiApiErrorToHttp(err)` → `c.json({ error, code, correlationId }, status)`,
  logged at `warn` (connectivity/upstream, not a bug). `correlationId` from
  `c.get('correlationId') ?? 'unknown'` (mirrors the global handler).
- anything else → **re-throw** so the global `app.onError` still owns it (unchanged
  500 / DomainError semantics). **Verify** Hono propagates a re-throw from a mounted
  sub-app's `onError` to the parent `onError`; if it does not, replicate the global
  500 shape here instead (documented fallback).

### 3. AC #5 — make `list_orders` agree on reachability

Currently list does zero I/O. Add a reachability probe so it fails the **same way**
get_order does when the source is down:

- Extend `OrderGateway` (`gateways/order.gateway.ts`) with
  `checkReachable(): Promise<void>` — throws `PegiiApiError` when the source is
  not configured / unreachable.
- Implement in `gateways/pegii-order.gateway.ts` via `client.getHealth()` (the
  existing unauthenticated `/health` probe; tunnel/HTTP failure → `PegiiApiError`).
- In the `GET /orders` list route: `const gw = await resolveOrderGateway(...)`
  (throws `PEGII_API_NOT_CONFIGURED` → 503), then `await gw.checkReachable()`
  (throws `PEGII_API_TUNNEL_ERROR` → 502) **before** returning the stub list. When
  reachable it still returns the (empty) stub — honest until a pegII collection
  endpoint exists.
- Tradeoff noted: list_orders now performs one `/health` round-trip per call. It is
  a low-volume workflow-runtime read; the AC explicitly requires the agreement.
- Update `services/pegii-orders.ts` header comment (no longer "zero I/O").

## Tests

`apps/api/src/handlers/pegii-runtime.test.ts` (existing harness mounts the handler
directly, so the router `onError` is exercised):

- get_order, gateway throws `PEGII_API_TUNNEL_ERROR` → **502**, body names pegII,
  has `correlationId`.
- get_order, `PEGII_API_NOT_CONFIGURED` (factory throw) → **503**.
- get_order, `PEGII_API_BAD_ENVELOPE` → **502**.
- get_order, gateway returns `null` → **404** (existing — keep green).
- get_order, gateway resolves the order → **200** (existing — update mock so
  `checkReachable` is present on the stub gateway).
- list_orders, `checkReachable` throws tunnel error → **502** (agrees with get).
- list_orders, `checkReachable` throws NOT_CONFIGURED / factory throw → **503**.
- list_orders, reachable → **200** with seeded rows (existing — add `checkReachable`
  resolving on the mock).
- a genuine non-`PegiiApiError` thrown from a route → still **500** (asserts the
  re-throw path; may need a tiny probe route or a forced throw via the mock).

`apps/api/src/lib/__tests__/pegii-api-client.test.ts`:

- unit-test `pegiiApiErrorToHttp` for each of the 5 rows above.

Update the mocked-gateway shapes in the existing pegii-runtime tests
(`resolveOrderGateway` mock currently returns `{ findOrderById }` — add
`checkReachable`).

## Acceptance criteria (from 0018) → how satisfied

- [ ] source unreachable → get_order returns **502/503**, message names the
      dependency → §1 TUNNEL_ERROR/NOT_CONFIGURED + §2.
- [ ] source reachable, unknown id → **404** → already handled (gateway null-maps
      upstream 404); covered by existing + kept test.
- [ ] genuine bridge bug → **500** → re-throw path in §2, reserved.
- [ ] all three carry a `correlationId` → §2 always includes it.
- [ ] list_orders and get_order agree on reachability → §3.

## Verify (before commit)

- `npm run -w apps/api test -- pegii-runtime pegii-api-client` green.
- `npm run typecheck` green (strict).
- `npm run -w apps/api lint` green.
- Manually confirm the router `onError` re-throw reaches `app.onError` (unit or a
  quick local `app.request` against a forced non-Pegii throw) so DomainError/500
  semantics are unchanged.

## Out of scope

- Tasks routes are stub-backed (no upstream call) so they cannot throw
  `PegiiApiError` today; they inherit the router `onError` for free once they swap
  to a gateway (no change needed now).
- No change to the global `app.onError`, the customers `pegii` gateway path, or the
  `/api/v1/orders` M2M reporting endpoint.
- 504-for-timeout refinement (spec only asks 502/503); timeouts map to 502 via
  TUNNEL_ERROR.

## Docs / feedback loop

- After merge + deploy, fill spec 0018's **Validation log** in
  `~/repos/pegasus-workflows/sdk-feedback/` and flip its README index row to
  `Validated` (live-check the 502/503 once the SDK/tenant can reach a down source,
  or note which ACs are unit-validated vs live-pending, per the loop's convention).
