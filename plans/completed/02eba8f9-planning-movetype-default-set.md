# Planning `move_type`: remove the eligibility whitelist

**Status:** completed
**Branch:** `fix/planning-movetype-default-set`
**Reported:** a dispatcher filtering Operations → Planning by **HHG Intrastate** saw shipments
that were not in the unfiltered results. Adding a filter should never add rows.

## Diagnosis

`move_type` has no column of its own — it filters `import_export`, the same column
`Is_Trip_Planning` ANDed a per-client eligibility whitelist onto (NWI: `H, HA, M, A, SS, Z`,
6 of the 16 codes the MoveType dropdown offers). Two predicates on one column, and both ways
of arbitrating between them are wrong:

| approach                  | result                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AND them (≤ #615)         | `IN ('I') AND IN ('H','HA','M','A','SS','Z')` — unsatisfiable. 10 of 16 codes returned zero rows, no explanation.      |
| Let the filter win (#628) | Selecting a non-whitelisted code **suppressed** the whitelist, so filtering **added** ~1,964 rows. ← what was reported |

HHG Intrastate is code `I`, one of the 10.

## Decision

Remove the whitelist rather than arbitrate. Approved by the user in-session: _"Lets get rid of
the default set entirely and allow any by default then filter on top of that."_

`Is_Trip_Planning` is now `shipment_status = 'A' AND del_actual IS NULL`, full stop.
`importExportTypes` is deleted from `longhaul-client-config.ts` — no remaining caller.

Every dropdown code is on the default board **and** narrowable from it, so the two rules that
were incompatible — "a filter can only narrow" and "every dropdown option returns something" —
both hold.

## Tests

Satisfiability **and** monotonicity, parameterized over all 16 real NWI lookup codes: pull every
`import_export IN (...)` clause from the generated SQL, resolve placeholders through the bound
params, and assert (a) the admissible set equals the selection and (b) it is a **subset of the
unfiltered query's**. Verified discriminating by reinstating the whitelist — (b) fails for
exactly the 10 non-whitelisted codes, `I` among them.

## Filter audit (asked during review: "do any other filters have this issue?")

**No filter does.** Every `where.push` in `buildBaseSql` is a pure conjunct; `moveTypeFiltered`
was the only suppression flag and it is gone. Findings recorded in GOTCHAS:

- **The search box has the same pathology** (not a filter, pre-existing, deliberate on-prem
  parity): `if (searchTerm.length >= 3) {…} else if (filters) {…}`. At three characters every
  filter **and both eligibility predicates** vanish — search returns cancelled and delivered
  orders with the date window gone. At two characters they all apply. Left as-is; flagged.
- **JS post-filters vs the row cap** (pre-existing, more reachable now): `TripStatus_id` and
  `latest_activity` filter in JS after `SELECT TOP (1001) … ORDER BY plan_load ASC`, so on an
  over-cap base they see only the 1001 earliest-planned-load rows. Post-filtering drops the
  count under 1000, so no `RESULT_LIMIT_EXCEEDED` fires and `meta.count` undercounts silently.
- **Cleared:** `delivery_date` vs `del_actual IS NULL` — `plan_del`/`del_date2` are both bounds
  of the _planned_ spread ("Del Date Spread"); no filter reads `*_actual`. The handler comment
  claimed otherwise and the parameter was named `actualCol` — both corrected here.
  `short_haul`(`haul_mode`) vs `shaul`(`shaul`) are distinct columns. `assigned` has no hidden
  `driver_id` exclusion in this handler.

## Open — verify after deploy

The whitelist also gated the **default** board (~15.9k → ~43.6k all-time eligible rows, 2.74×).
`SHIPMENT_RESULT_LIMIT` is 1000 with a hard 400. The board's default query is scoped (±30-day
load window, assigned=No, sit_dest=No), so the all-time figure is not what loads — **but the
prod measurement was not run** (expired SSO token for the whole session). Query is staged in
the PR body. If the default board exceeds 1000, narrow tenant-web's `DEFAULT_QUERY` load
window — **do not reinstate the whitelist**, which would undo the monotonicity property.

Also worth a look on the same query: NULL/blank `import_export` rows now reach the board
(`IN (...)` had excluded them; `getMoveType` renders them blank, i.e. like HHG Interstate), and
**QMM**, whose old whitelist exactly equaled its restrictive dropdown, can now show default rows
whose code is not in its dropdown at all.
