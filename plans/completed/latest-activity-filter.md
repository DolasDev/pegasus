# Last Activity filter — Operations planning screen

## Goal

Add a **Last Activity** filter to the driver-planning (Operations planning) shipment
filters. It matches on exactly the activity the shipment card already renders in its
final column — `latest_activity_abbr` — so the filter and the card agree by
construction.

## Background — what the card shows

`ShipmentCard` renders `${latest_activity_abbr}: ${latest_activity_date}`.
`latest_activity_abbr` is **not** a view column: it is derived per-row in the API by
`enrichShipmentWithTripInfo` (`apps/api/src/lib/longhaul-shipment-enrich.ts`) from
`getTripInfo(activities)` — the earliest unfinished activity, else the most recently
completed one — and set to that activity's `activityType_abbreviation`.

Because the value is computed in JS _after_ the base SQL query, the filter cannot be a
`WHERE` clause. It belongs where the existing `TripStatus_id` filter already lives: a
post-enrichment pass in `longhaulShipmentsListHandler`.

## Design decisions

1. **Match on `latest_activity_abbr`, not a new code field.** The ask is "match the
   activity populated on the shipment card", and the card shows the abbreviation.
   This needs no change to the enrichment lib and no change to the
   `@pegasus/longhaul-contracts` column manifest. If two activity types share an
   abbreviation, grouping them is correct under card semantics.
   Compare **trimmed** on both sides (`String(x).trim()`) — legacy `nvarchar` columns
   in this DB are known to carry padded values (#628).

2. **Filter server-side, post-enrichment** — the same loop and the same `continue`
   placement as the `TripStatus_id` filter, so `meta.count` stays truthful.
   Inherited semantics are kept deliberately, not redesigned:
   - the post-filter also applies when `searchTerm` is set (SQL ignores filters there);
   - the 1001-row base cap is applied _before_ the post-filter.
     Both are pre-existing `TripStatus_id` behavior; this is a faithful mirror.

3. **Dropdown options ride the existing reference-data batch.** Bootstrap was
   deliberately collapsed into one `/reference-data` request (see the comment in
   `AppGuard`); a second fetch would reintroduce the fan-out this replaced. Append
   `SELECT code, name, abbreviation FROM Longhaul_ActivityType` to the _common_ batch
   (it is client-independent), which shifts the per-client recordset indices 5,6 → 6,7
   in **both** unpacking branches.
   Options are built as `{ value: abbreviation, label: abbreviation }` — the label is
   **just the abbreviation**, exactly the token the card prints — with null/empty
   abbreviations dropped and duplicates collapsed by abbreviation.

4. Only the cloud handler needs this. `/shipments` is served cloud-direct
   (longhaul Phase 3) and no longer falls through to the on-prem proxy, so there is
   no second implementation to keep in sync.

## Changes

### API (`apps/api`)

- `src/handlers/longhaul-cloud/shipments-list.ts`
  - add `latest_activity?: Array<{ value: string }>` to `ShipmentFilters`;
  - in the assemble/enrich loop, build a wanted-Set of trimmed abbreviations and
    `continue` on non-match, immediately after the existing `TripStatus_id` check
    (i.e. after `enrichShipmentWithTripInfo`, before `buildShipmentActivities`);
  - comment why this cannot be a SQL predicate.
- `src/handlers/longhaul-cloud/reference-data.ts`
  - append the `Longhaul_ActivityType` statement to `COMMON_BATCH_SQL`;
  - bump the per-client recordset indices (5,6 → 6,7) in both branches;
  - return `filterOptions.activityType` (mapped, deduped, sorted by label) so a
    single existing slice key carries it — including when no `longhaulClient` is
    configured, where it is still populated (the activity-type catalog is not
    client-specific) while `moveType`/`dispatchers` stay empty.

### Tenant web (`apps/tenant-web`)

- `src/features/driver-planning/redux/common/index.ts`
  - nothing new needed beyond passing the enlarged `filterOptions` through — verify
    `fetchFilterOptionsSuccess` already stores the whole object (it does), and extend
    the `MSSQL_NOT_CONFIGURED` degradation fill to `{ moveType: [], activityType: [] }`.
- `src/features/driver-planning/containers/Shipments/components/FilterTabs/index.tsx`
  - add `{ label: 'Last Activity', property: 'latest_activity', type: 'last-activity' }`
    to `FIELDS`;
  - add a `last-activity` case to `renderFilterComponentByType` — an `isMulti`
    `Select` reading `filterOptions?.activityType`, matching the `move-type` case.
  - **Keep the panel at 5 columns.** Today the chunker slices `FIELDS` into fixed
    runs of `FIELDS_PER_COLUMN = ceil(FIELDS.length / 5)`. At 16 fields that is 4,
    which yields 4 chunks of 4 — the panel silently drops to 4 columns. Replace the
    fixed-slice chunker with a **balanced** distribution that always produces exactly
    `COLUMNS` chunks (16 fields → 4/3/3/3/3), so adding this field — or any future
    field — reflows within the existing 5 columns instead of changing their count.
- No change to `FilterModal` / `SaveFilterModal`: saved filters persist the whole
  query JSON, so the new key round-trips for free.
- No change to `DEFAULT_QUERY`: the filter is off by default.

### Contracts

- No change to `packages/longhaul-contracts` — `latest_activity_abbr` is already in
  the manifest and no new row field is introduced.

## Tests (TDD — write first)

- `apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts`
  - a selection keeps only shipments whose enriched `latest_activity_abbr` matches;
  - multiple selections OR together;
  - an empty/absent filter changes nothing;
  - a **padded** abbreviation (`'PK '`) still matches `'PK'`;
  - a shipment with no activities (null abbr) is excluded when the filter is set;
  - the filter composes with `TripStatus_id` (AND) and `meta.count` reflects it.
- `apps/api/src/handlers/longhaul-cloud/reference-data.test.ts`
  - the new recordset is unpacked into `filterOptions.activityType`, deduped, with
    null abbreviations dropped;
  - the per-client indices still resolve `dispatchers` + `moveType` correctly;
  - the no-`longhaulClient` branch still returns the activity types.
- Tenant-web: a FilterTabs render test asserting the `latest_activity` filter row
  exists with options sourced from `filterOptions.activityType`, and that changing it
  dispatches `changeShipmentQuery` with the new key.

## Verification

- `npm run typecheck`, `npm test`, `npm run lint` at the root.
- Manual: open Operations → Planning, expand Filters, pick a Last Activity value, and
  confirm every remaining shipment card's last column starts with that abbreviation.

## Out of scope

- Filtering on the last-activity **date** (a separate range filter).
- Changing which activity `getTripInfo` selects.
- Raising the 1001-row base cap or moving the post-filters into SQL.
