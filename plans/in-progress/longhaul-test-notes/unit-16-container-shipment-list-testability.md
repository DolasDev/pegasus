# Unit 16 — Shipment list containers — Testability notes

While writing tests for the shipment list containers I observed two areas
where production code could be lightly refactored to make tests cheaper.
**No production code was changed; these are only proposals.**

## 1. `Card` component drops the `data-target` prop

`apps/tenant-web/src/features/driver-planning/components/Card/index.tsx`
declares `'data-target'?: string` in its props interface but never spreads
it onto the rendered `<div>`. As a result, the `data-target="shipment-card"`
prop set on `ShipmentCard` is silently lost, and tests cannot use
`querySelector('[data-target="shipment-card"]')` to locate a card.

Workaround used in tests: query by visible text inside the card (e.g. the
order number).

Suggested refactor: spread `...rest` (or specifically forward
`data-target`) onto the root `div` so callers' attributes survive.

## 2. CSS Module class hashing makes selectors fragile

CSS-module classnames are hashed at build time, so tests cannot rely on
`.shipmentCard` etc. We worked around this by using accessible queries
(`getByText`, `getByPlaceholderText`) and by querying the document body
for portal-rendered Radix dialog content.

Suggested refactor: add a small set of stable `data-testid` attributes
to root elements of the cards / modals (e.g. `data-testid="shipment-card"`,
`data-testid="filter-modal-save-button"`). This would not affect runtime
behaviour but would dramatically simplify integration-style tests.

## 3. `Shipments/index.tsx` reads `tripPlanning.shipmentToTrips` via a
   `(state as any)` cast

The `MemoizedShipmentCards` selector uses `(state as any).tripPlanning…`
because `RootState` from `redux/store.ts` does not include the
`tripPlanning` slice in its narrow re-exported types. Same for
`version.release_channel`. This is testable as-is but obscures the real
state shape. Suggested follow-up: ensure `RootState` reflects all
reducers without `as any` casts.

## 4. `FilterModal` & `SaveFilterModal` Radix dialogs render into a portal

Tests need `document.body.querySelector` (or `screen` from Testing
Library) instead of `container.*`. This is a Radix detail, not a bug —
just noting for future test authors.
