# Trip itinerary — WGS indicators on shipment activity cards

## Problem

Operations users want the shipment activity cards in the **Trip itinerary** view to
surface **WGS** (White Glove Service) status, the same way the **ShipmentCard**
already does. Today the itinerary card renders only a VIP/super-VIP indicator
(`far fa-id-badge`, green for super-VIP, purple for VIP). There is no WGS signal,
so a WGS shipment is indistinguishable from a non-WGS one once it's on a trip.

## Source of truth

`apps/tenant-web/.../containers/Shipments/components/ShipmentCard/index.tsx`
`getShipmentIndicator()` derives one combined label from three shipment fields:

| type_packing | supervip | vip | label |
| ------------ | -------- | --- | ----- |
| Y            | Y        | —   | S-WGS |
| Y            | —        | Y   | V-WGS |
| Y            | —        | —   | WGS   |
| —            | Y        | —   | S-VIP |
| —            | —        | Y   | VIP   |

WGS is driven purely by `type_packing === 'Y'`.

## Data availability — no backend change

`Trip/index.tsx` reads `activity.shipment.*`. Each `activity.shipment` is the full
`v_longhaul_shipments_v2` row (`SELECT s.*` in `lib/longhaul-trip-fetch.ts`),
stitched onto activities by `order_num` in `utils/api/reshape-trip.ts`. That row
already carries `type_packing`, `supervip`, and `vip` — the same source the
ShipmentCard uses. So this is **frontend-only**.

## Change

File: `apps/tenant-web/src/features/driver-planning/containers/Trip/index.tsx`

Keep the trip's existing **icon + tooltip** paradigm (don't port the rotated text
badge). The current `vipIndicator` block renders the VIP id-badge. Add a WGS icon
**alongside** it so combined cases (S-WGS / V-WGS) show both the VIP badge and the
WGS icon:

- New `wgsIndicator`: when `activity.shipment.type_packing === 'Y'`, render a
  red White Glove Service icon (`fas fa-hand-sparkles`) wrapped in a
  `HoverToolTip content="White Glove Service (WGS)"`, matching the ShipmentCard's
  red WGS color coding. Otherwise render nothing.
- Render `{wgsIndicator}` next to `{vipIndicator}` in the card's icon span.

## Test

File: `apps/tenant-web/src/features/driver-planning/containers/Trip/index.test.tsx`

- Existing test asserts exactly one `i.fa-id-badge` for the VIP-only fixture — keep it.
- Extend the fixture / add a case so one activity's shipment has
  `type_packing: 'Y'` and assert the WGS icon (`i.fa-hand-sparkles`) renders for
  it, and that a plain shipment renders neither icon.
- Cover a combined case (e.g. `vip: 'Y'` + `type_packing: 'Y'`) → both the
  id-badge and the WGS icon present.

## Verification

- `npm run typecheck` + `npm test` in `apps/tenant-web`.
- Optional: `apps/tenant-web:verify` skill to eyeball the itinerary card.

## Out of scope

- No change to ShipmentCard, its CSS, or the API/SQL.
- No change to trip summary VIP/super-VIP counts (`longhaul-cloud-trip-summary.ts`).
