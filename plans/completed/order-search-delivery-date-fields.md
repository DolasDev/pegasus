# Order search — delivery/SIT date fields + `longDistancePlanned` (SDK 0.63.0)

Branch: `feat/order-search-delivery-dates`. Goal: `search_orders` / `GET /api/v1/pegii/orders/search`
can select on the delivery and SIT dates, and each item carries `lng_dis_del_plan`.
Answers pegasus-workflows `sdk-feedback/0050` (select orders by planned delivery date).

## Checklist

- [x] Site (movemanager `0d46ee60`, on `dev`): whitelist `del_date`, `plan_del`, `sit_date`,
      `lng_dis_del_plan`; `longDistancePlanned` result field; advertises `pegii.orders.search.v2`
- [x] `pegii-order-search.dto.ts`: v1/v2 field lists, `isV2OrderSearchDateField`, optional `longDistancePlanned`
- [x] `PegiiCapabilities.OrdersSearchV2`; gateway requires it ONLY for the four v2 fields
- [x] OpenAPI enum derived from `ORDER_SEARCH_DATE_FIELDS` (was a hand-kept copy); per-field meanings
- [x] SDK 0.63.0: `ORDER_SEARCH_DATE_FIELDS`, docstring, README, MCP guide, CHANGELOG, `fake_client` test
- [x] Authoring repo `CLAUDE.md` + 0050 header updated (uncommitted there, pending SDK publish)
- [ ] After merge: tag `sdk-python-v0.63.0`
- [ ] After NW auto-updates (advertises `pegii.orders.search.v2`): run 0050's live acceptance script, fill its validation log

## KeyDate meanings (`LoHiConverters_Sale.vb`) — they do not follow the column names

`del_date` = Delivery Planned · `plan_del` = Delivery Latest · `sit_date` = SIT-out Planned ·
`lng_dis_del_plan` = LongDistance Planned (the desktop's "ETA Date").

## Tests

- `npm test` affected packages + full `apps/api` vitest (5,080) + typecheck; SDK pytest (591) + `ruff check`.
- E2E not applicable: no Playwright spec covers `/pegii/orders/search`, and it needs a live pegII
  site over the tunnel; the live check is 0050's NW acceptance run.

## Risks

- Sites update on their own cadence: an un-updated site keeps serving the v1 fields; a v2 field there
  is 503 `PEGII_CAPABILITY_MISSING` (not a confusing 400). `longDistancePlanned` is absent, not null,
  from such sites — documented as "read it with `.get`".
