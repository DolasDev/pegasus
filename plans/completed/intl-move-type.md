# fix: INTERNATIONAL move type returns no shipments in Operations → Planning

## Problem

Filtering the driver-planning shipment list by move type **INTERNATIONAL** (`Z`)
returns zero rows, for every date range and zone. Reported against NWI with:

```json
{
  "filters": {
    "Is_Trip_Planning": true,
    "load_date": ["2026-07-11", "2026-09-09"],
    "origin_zone": [{ "label": "North East", "value": "1" }],
    "move_type": [{ "value": "Z", "label": "INTERNATIONAL" }]
  },
  "sortBy": {}
}
```

## Root cause

`move_type` is not its own column — it filters `import_export`. Two predicates
therefore land on the **same column**, AND'd together, in
`apps/api/src/handlers/longhaul-cloud/shipments-list.ts`:

| line | source                                | predicate                                  |
| ---- | ------------------------------------- | ------------------------------------------ |
| 223  | the user's `move_type` filter         | `import_export IN ('Z')`                   |
| 250  | `Is_Trip_Planning` (hardcoded `true`) | `import_export IN ('H','HA','M','A','SS')` |

`'Z'` is absent from NWI's `importExportTypes`
(`apps/api/src/lib/longhaul-client-config.ts:61`), so the conjunction is
provably empty. The same holds for QMM (`N,S,C,U,M`) and for any other
non-whitelisted code — INTERNATIONAL is just the one that got noticed.

Three things make it unavoidable from the UI:

- `Is_Trip_Planning: true` is hardcoded in `DEFAULT_QUERY`
  (`apps/tenant-web/src/features/driver-planning/redux/shipments/index.ts:21`)
  and is not exposed as a FilterTab — there is no way to turn it off.
- The Move Types dropdown is built from the `MoveType` lookup filtered by
  `moveTypesWhere`, which for NWI is `'1=1'` — so it offers **every** move type,
  including ones the planning whitelist forbids.
- Nothing surfaces the contradiction; the list just comes back empty.

**Not a port regression.** The legacy app does the same thing —
`longhaul/server/modules/shipments/shipment.repository.v2.ts:171` maps
`move_type` → `import_export IN`, and `:214` AND's the client whitelist on the
same column. INTERNATIONAL returned zero rows there too.

## Decision

Three fixes were presented; the user chose **option 1: add `'Z'` to NWI's
`importExportTypes`**, making INTERNATIONAL trip-planning-eligible.

The tradeoff was flagged and accepted: `importExportTypes` gates the whole
`Is_Trip_Planning` predicate, so this also changes the **default, unfiltered**
planning list — active, undelivered `Z` shipments now appear for NWI users who
have applied no move-type filter at all. That is the intended outcome, not a
side effect: the alternative (option 2, letting an explicit `move_type` filter
override the whitelist) was declined.

Not chosen: option 2 (explicit filter overrides the eligibility list) and
option 3 (trim the dropdown to the eligible intersection).

## Scope

- `apps/api/src/lib/longhaul-client-config.ts` — add `'Z'` to `nwi.importExportTypes`,
  with a comment recording why (and that QMM is deliberately unchanged).
- `apps/api/src/lib/longhaul-client-config.test.ts` — update the three NWI
  `importExportTypes` assertions.
- `apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts` — add a
  regression test: `Is_Trip_Planning: true` + `move_type: [{value:'Z'}]` must
  produce a satisfiable SQL predicate (both `IN` lists bind `Z`), so the
  conjunction can no longer be empty by construction.
- `apps/tenant-web/.../Shipments/components/ShipmentCard/index.tsx` (+ its test)
  — add `'Z'` to the `getMoveType` badge list. **Consequence of the decision
  above, not separate scope:** before this change a `Z` row could never reach
  the planning list, so its blank badge was unreachable. Now that `Z` rows show
  up in the _default_ list, a blank badge makes them indistinguishable from
  Interstate (`'H'`, deliberately unbadged as the common case).

QMM's list is left alone — its `moveTypesWhere` excludes `Z` from the dropdown
entirely, so there is nothing to reach.

## Out of scope

- Options 2 and 3 above.
- The general class of "any non-whitelisted move type filters to nothing" —
  option 1 fixes `Z` specifically. Left as a known, documented sharp edge.
- `apps/tenant-web/src/features/driver-planning/utils/movetype-list.ts`
  (`MOVETYPE_LIST`) — a hardcoded 5-entry move-type list whose only consumer is
  its own test. The dropdown is served by the API (`filter-options.ts`), which
  is why the reported query carried `Z`/INTERNATIONAL at all. Dead code; a
  deletion candidate, deliberately not extended here.
- The commented-out `visible` list in `Trips/components/TripCard/index.tsx:14`.

## Verification

- `npm test` / `npm run typecheck` in `apps/api`.
- Post-deploy: re-run the reported query on NWI and confirm rows return.
- Prod data confirmation (count of `v_longhaul_shipments_v2` rows with
  `import_export='Z' AND shipment_status='A' AND del_actual IS NULL`) is
  **still pending** — prod SSO was expired during investigation. Worth running
  after `aws sso login --sso-session dolas` to quantify how many rows this adds
  to the default planning list.
