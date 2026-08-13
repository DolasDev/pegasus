# Make every planning move-type filter option satisfiable

## Problem

Operations → Planning offers a **Move Types** multi-select whose options come
straight from the legacy `MoveType` lookup (`filter-options.ts` /
`reference-data.ts`, filtered by the per-client `moveTypesWhere`). For NWI that
fragment is `1=1`, so the dropdown advertises **all 16** codes.

`move_type` has no column of its own — it filters `import_export`
(`shipments-list.ts:227`), the _same_ column the hardcoded `Is_Trip_Planning`
predicate ANDs its per-client eligibility whitelist onto (`:251`). Selecting a
code outside that whitelist produces an unsatisfiable conjunction:

```sql
import_export IN ('OA') AND import_export IN ('H','HA','M','A','SS','Z')
```

#615 fixed exactly one code (`'Z'`, INTERNATIONAL) by adding it to the
whitelist. **10 of the 16 remain broken.** Verified against prod NWI
(`9d869236-518f-4fe4-90d3-274a1b957c38`), counting
`shipment_status='A' AND del_actual IS NULL`:

| code | description                 | eligible rows |
| ---- | --------------------------- | ------------: |
| OA   | ORIGIN SERVICE ONLY         |        16,507 |
| DA   | DEST SERVICE ONLY           |         4,866 |
| LC   | LOCAL COMM'L                |         2,778 |
| I    | HHG INTRASTATE              |         1,964 |
| L    | LOCAL MOVES                 |         1,317 |
| P    | PERM STORAGE                |           359 |
| SP   | SPECIAL PRODUCTS            |           154 |
| C    | COMM TRUCKLOAD              |            94 |
| TC   | TIME CRITICAL               |            86 |
| OF   | OVERFLOW                    |             3 |
|      | **broken total**            |    **27,718** |
|      | whitelisted (H/Z/HA/M/A/SS) |        15,896 |

Broken options cover **64%** of the 43,614 rows the screen could reach. Because
the filter is multi-select there is also a quiet variant: picking a broken code
_alongside_ a working one returns a silently incomplete list rather than zero
rows.

QMM is **not** affected — its `moveTypesWhere` (`C,S,N,M,U`) and its
`importExportTypes` (`N,S,C,U,M`) are the same set, so every option it offers is
satisfiable.

## Decision — override, not widen

Repeating the #615 shape (adding all 10 codes to `importExportTypes`) is not
viable: that whitelist also gates the **default unfiltered** planning list, so
widening it takes the default from ~15,896 to ~43,614 eligible rows — dumping
LOCAL MOVES / PERM STORAGE / ORIGIN SERVICE ONLY onto central dispatchers by
default and blowing the 1000-row `RESULT_LIMIT_EXCEEDED` cap.

The general fix was proposed and **declined during #615**, when only one code was
known broken. Re-raised with the counts above and **approved**: an explicit
`move_type` filter **overrides** the whitelist. The whitelist keeps its role as
the _default_ eligibility set; the other two `Is_Trip_Planning` predicates
(`shipment_status='A'`, `del_actual IS NULL`) always apply.

Net effect: default list byte-for-byte unchanged; all 16 options return rows.

## Second defect — badge drops on padded codes

`import_export` is `nvarchar` and prod holds the **same logical code both padded
and unpadded** (`'M'` 470 rows, `'M '` 1,404 rows). SQL Server's `=`/`IN`
ignore trailing spaces, so filtering is unaffected — but nothing trims the value
on the way out, and `ShipmentCard`'s `getMoveType` does a JS
`visible.includes(moveType)`. `'M '` fails that check, so **MILITARY and
INTERNATIONAL cards render no badge on the majority of rows** — indistinguishable
from Interstate, which is the exact failure mode #615's badge change existed to
prevent. Inconsistent row-to-row within a single code.

## Tasks

1. **`apps/api/src/handlers/longhaul-cloud/shipments-list.ts`** — track whether an
   explicit `move_type` filter was applied; when it was, skip the whitelist
   clause inside the `Is_Trip_Planning` block. Keep `shipment_status` and
   `del_actual` unconditional.
2. **`apps/tenant-web/.../Shipments/components/ShipmentCard/index.tsx`** — trim
   the code before comparing, and badge every code except `'H'` (the deliberately
   unbadged common case) so codes newly reachable via the override can't render a
   blank badge. Inverting the check also means a future lookup addition is badged
   automatically.
3. **Tests (api)** — generalize #615's satisfiability test: for **every** code in
   NWI's real 16-code lookup, build the SQL, pull every `import_export IN (...)`
   clause out, resolve placeholders through the bound params, and assert the sets
   intersect. Assert the _unfiltered_ default still emits the whitelist clause
   verbatim (guards the "default unchanged" promise). Cover the multi-select
   mixed case (broken + working code together).
4. **Tests (tenant-web)** — badge renders for padded (`'M '`) and unpadded (`'M'`)
   codes; `'H'`/`'H '` stay unbadged; a newly-reachable code (`'OA'`) badges.
5. Update `dolas/agents/project/GOTCHAS.md` — the same-column clash entry from
   #617 now has a general fix; note the padding hazard on `import_export`.

## Out of scope

- Curating _which_ of the 10 codes also belong in the **default** eligibility set
  (an operations decision, per code). The override makes them all filterable
  without touching the default.
- `apps/tenant-web/src/features/driver-planning/utils/movetype-list.ts` — dead
  code (only its own test consumes it); deletion is a separate cleanup.
- The 6 junk `import_export` rows in prod (`NULL`, `'  '`, `'uA'`) — not in the
  lookup, not selectable, negligible.

## Verification

- `npm test` in `apps/api` and `apps/tenant-web`; `npm run typecheck` at root.
- Read-only prod re-check after merge: filtering by `OA` returns ~16,507 rows and
  the unfiltered default still returns the same set as before.
