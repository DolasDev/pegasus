# Services board: shipment drawer, trip link, dispatch roles

Branch: `feat/services-detail` (worktree `services-detail`)

## Request

1. Selecting a service card opens the Shipment Detail panel, the same way
   selecting a shipment card does on Planning.
2. The trip number on a card links to the trip screen.
3. Services is visible to the LD Dispatch and Central Planning roles.

## Done

- ActivityCard: clicking the card dispatches `selectShipment({ order_num })`. The
  thunk fetches the full row, so only the order number is needed. The click calls
  stopPropagation because the drawer closes on any outside click. The card shows
  `active` while its order is the one selected. Cards with no order do nothing.
- The trip cell is a `Link` to `/trip/:id` (router-compat rewrites it to
  /driver-planning/trips/:id). It stops propagation, so following it does not
  also select the shipment.
- ActivitiesModule mounts `<ShipmentDetail />`.
- styles.css: the drawer-sizing rule now applies to the Services layout as well
  as Planning.
- Roles: `DISPATCH_ACTIVITIES_ROLES` is removed, and the route and nav child use
  `OPERATIONS_ROLES`. The server already granted these roles full reads
  (`apps/api/src/lib/longhaul-read-scope.ts` OPERATIONS_ROLES), so nothing
  changed server-side.

## Verification

- tenant-web: 1229 unit tests pass, plus tsc and eslint.
- The new browser spec `apps/e2e/tests/browser/services-shipment-detail.spec.ts`
  (stubbed API, @local-only) passes against an e2e-mode build. With the CSS rule
  removed it fails: the drawer bottom lands at 745px against a root bottom of 697px.
