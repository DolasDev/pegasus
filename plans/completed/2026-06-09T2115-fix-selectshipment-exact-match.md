# Fix `selectShipment` to look up a shipment by exact order number

**STATUS: RESOLVED (2026-06-09).** Implemented approach 1 (client-side post-filter, no
API/infra change) in `apps/tenant-web/src/features/driver-planning/redux/shipments/index.ts`:
`selectShipment` now resolves the row whose `order_num` exactly equals the request and treats
"no exact match" / empty results as not-found (`fetchShipmentFailure` + `notifyError`) instead
of trusting `result[0]`. Regression tests added to `shipments.test.ts` (prefix near-match,
exact-among-prefixes, empty-set not-found). 47/47 tests pass; tenant-web typecheck clean. The
`longhaul-test-notes/` backlog directory was removed in the same change — all items were either
resolved by PRs #160–#185 or by this fix.

**Origin:** `plans/in-progress/longhaul-test-notes/unit-08-redux-shipments-bugs.md` item #7 — the
only substantive item from the May-1 driver-planning test-notes backlog that was _not_
addressed by the refactor series (PRs #160–#185). All other items in those notes are resolved;
see the resolution matrix in the session that created this plan.

## Problem

`apps/tenant-web/src/features/driver-planning/redux/shipments/index.ts` (`selectShipment`,
~lines 165-178) resolves a single shipment via a **fuzzy text search**:

```ts
const shipment = await API.fetchShipments({ searchTerm: String(selectedShipment.order_num) })
dispatch(fetchShipmentSuccess(shipment[0]))
```

`searchTerm` is a substring/prefix match, and the thunk blindly trusts `result[0]`. If two
shipments share an order-number prefix (search `7` → matches `7`, `70`, `71`, …), `shipment[0]`
can be the **wrong row**, silently loading the wrong shipment into `selectedShipment`.

## Goal

`selectShipment` returns the shipment whose `order_num` **exactly equals** the requested one,
or a clean "not found" (`fetchShipmentSuccess(null)` + surfaced error) — never a near-match.

## Approach (decide during planning)

Two viable routes; pick based on what the longhaul-cloud API already exposes:

1. **Exact filter client-side (smaller change):** keep using `API.fetchShipments`, but pass an
   exact-match filter if the backend supports one, and/or post-filter the response:
   `result.find(s => String(s.order_num) === String(selectedShipment.order_num)) ?? null`.
   Dispatch `fetchShipmentFailure`/`notifyError` when nothing matches.
2. **Dedicated endpoint (cleaner, larger change):** add `API.fetchShipmentByOrderNum(orderNum)`
   backed by a `longhaul-cloud` handler that selects a single row by exact order number.
   Check `apps/api/src/handlers/longhaul-cloud/` for an existing single-shipment read before
   adding one.

Recommendation: start with (1) post-filter — it removes the wrong-row bug with no API/infra
change and no deploy coupling. Escalate to (2) only if product wants a true single-row fetch.

## Tasks

- [ ] Confirm whether `longhaul-cloud` shipments handlers already expose an exact
      single-shipment read; if so, prefer wiring to it.
- [ ] Implement exact-match resolution in `selectShipment` (post-filter or dedicated call).
- [ ] On no match: dispatch `fetchShipmentFailure` and `notifyError`, leave `selectedShipment`
      untouched or null — do not load a near-match.
- [ ] Update/extend the shipments slice tests (`shipments` redux unit) to lock in:
      exact match returned; prefix collision does NOT return the wrong row; no-match path
      surfaces an error. Mock `../../utils/api` as the existing tests do.
- [ ] `npm run typecheck` + the driver-planning test suite green.

## Out of scope (explicitly deferred, not bugs)

- Pervasive `any` typing across the driver-planning slices/components (unit-09 #1, unit-10 #10,
  unit-13 #5). The note authors flagged these as **non-blocking**; tackle as a separate typing
  pass if desired, not as part of this fix.

## Done when

- `selectShipment` cannot return a prefix near-match; covered by a regression test; typecheck +
  tests green. Then delete the `longhaul-test-notes/` directory (its remaining content is now
  either resolved or captured here).
  </content>
