# Actual-weight scale icon on the planning shipment card

**Branch:** `feat/shipment-card-actual-weight-icon`

**Goal:** Show the ShipmentDetail "Actual Weight" scale icon on each planning
shipment card — gold when the shipment has no actual weight, green when it does —
so a planner can see at a glance which orders still need weighing without opening
the detail panel.

## Context (traced, no re-reading needed)

- The detail panel's icon lives in
  `apps/tenant-web/src/features/driver-planning/containers/ShipmentDetail/components/Weight/index.tsx`:
  `<i className="fas fa-scale-unbalanced-flip">` colored `green` when
  `pegasus_shadow?.weight` is truthy, `orange` otherwise. That component is also the
  _editor_ (popover); the card only needs the read-only indicator.
- "Actual Weight" == the `sales` shadow table's weight. `shipments-list.ts:352`
  selects `ps.weight AS shadow_weight`; `utils/api/reshape-shipment.ts` nests it as
  `pegasus_shadow.weight` for **every row in the list**, so the card already has the
  data — no API, contract, or query change.
- `applyShipmentShadow` (redux/shipments) merges the DTO into the matching
  `shipmentList` row, so saving a weight in the detail popover live-flips the card
  icon to green with no refetch.
- The card's est-weight cell is row-0 idx 2 (`getFormattedWeight(shipment.total_est_wt)`).
  `.row > div` is `overflow: hidden`, which is why idx 3/4 opt into `styles.icon`
  (`overflow: visible`) for their existing badges — idx 2 must join them or the
  tooltip gets clipped.

## Checklist

- [x] `ShipmentCard/index.tsx`: replace `getFormattedWeight` with a helper that renders
      the est weight followed by the scale icon in a `HoverToolTip`, matching the
      `getPackDateStart` badge shape. Tooltip: `Actual Weight: <n>` / `No Actual Weight`.
- [x] Color: `pegasus_shadow?.weight` truthy → `green`, else `goldenrod` (see risk below).
      Truthy check deliberately matches the detail panel: 0 counts as no actual weight.
- [x] Add `idx === 2` to the `styles.icon` condition so the tooltip isn't clipped.
- [x] `ShipmentCard/index.test.tsx`: add an `actualWeightIconColor` helper mirroring the
      existing `sitIndicatorColor`, and cases for `pegasus_shadow: null`,
      `{ weight: null }`, `{ weight: 0 }` → gold; `{ weight: 16200 }` → green. Confirm the
      existing est-weight rendering (`5000`) still asserts.
- [x] Read-only — no click handler. The card's `onClick` selects the shipment and the
      edit popover is anchored in the detail pane; a nested control would need
      `stopPropagation` and duplicate the editor.
- [x] `npm run typecheck` + tenant-web vitest, then one PR through the merge queue.

## Files

- `apps/tenant-web/src/.../Shipments/components/ShipmentCard/index.tsx` (modify)
- `apps/tenant-web/src/.../Shipments/components/ShipmentCard/index.test.tsx` (modify)

No API, contract, CSS-module, or e2e changes. `PlanningPage.ts` locates cards only by
`data-target`/`data-order-num`, so the extra cell content is inert to e2e.

## Outcome

Shipped as planned. `goldenrod` kept (user confirmed); actual weight kept shadow-only
(user confirmed) — the view's `weight` column is deliberately not consulted.
Verified: 34 ShipmentCard tests, full tenant-web suite 1429/1429, typecheck + lint clean.

## Risks / open questions

1. **Contrast.** `.accepted .row` (TripStatus 3) has a pale-yellow background
   `rgba(255,242,189,.912)` — pure `gold` nearly vanishes on it. Plan uses `goldenrod`,
   which still reads gold and survives that row. Swap to `gold`/`orange` on request.
2. **Two things are called "actual weight."** `v_longhaul_shipments_v2.weight` (ord 46)
   is the trip roll-up's actual weight (#593); the detail panel's "Actual Weight" row
   reads _only_ the `sales` shadow. Mirroring the detail panel means a shipment already
   weighed in the source system shows gold until someone enters it in Pegasus. Face-value
   reading of the request is shadow-only, so that's what this does — folding in the view
   column is a one-token change (`?? shipment.weight`) if that's wanted instead.
