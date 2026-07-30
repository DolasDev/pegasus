# fix: Planning driver typeahead must list every active driver

## Problem

Operations → Planning's driver typeahead silently drops real drivers. Reported
example: `DRIVER_ID 99995`, `DRIVER_NAME "CSS, C&F"`, `AGENT_CODE 3201`,
`ACTIVE 'Y'`, `TYPE 'NWSUB'` — a genuine subcontractor record that never appears
in the dropdown.

## Root cause

Not `TYPE` — nothing in the codebase reads that column. It is the hardcoded
sentinel-ID exclusion in `apps/api/src/handlers/longhaul-cloud/driver-filter.ts`:

```ts
;`${p}ACTIVE = 'Y' AND ${p}DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)`
```

Introduced by `b48f1d21` ("rework Availability card + filter drivers to match
Planning"). Before that commit `/drivers` and `/reference-data` — the two feeds
behind the typeahead — had **no** `WHERE` clause; every row came through. That
commit added the shared predicate to all three driver reads to keep the
Availability card and the Planning dropdown in lockstep, on the assumption that
99994–99999 are placeholder/system rows. That assumption is wrong for at least 99995.

## Approved decision (user, this session)

**Split the two lists.** The Availability card and the Planning typeahead have
different needs and no longer stay in lockstep:

- **Typeahead / reference-data** (`/drivers`, `/reference-data`) → `ACTIVE = 'Y'`
  only. Every active driver must be pickable; a driver you cannot select is a
  hard functional gap, whereas an extra row in a searchable dropdown is not.
- **Availability card** (`/driver-planning`) → keeps `ACTIVE = 'Y'` **plus** the
  99994–99999 exclusion. It renders one card per driver with no search, so
  placeholder rows are real visual noise there.

Rejected alternatives: dropping the exclusion everywhere (re-pollutes the
Availability card); narrowing the ID list (we have no read access to
`v_longhaul_drivers` from the dev seat to determine which of the six are junk).

## Tasks

1. `apps/api/src/handlers/longhaul-cloud/driver-filter.ts`
   - Replace the single `longhaulDriverFilter(prefix)` export with two named
     predicates that say what they are for: - `activeDriverFilter(prefix)` → `ACTIVE = 'Y'` — selectable drivers
     (typeahead + reference-data). - `availabilityDriverFilter(prefix)` → `ACTIVE = 'Y' AND DRIVER_ID NOT IN
(…)` — the Availability card only, composed from `activeDriverFilter`.
   - Rewrite the header comment: it currently asserts the two lists MUST match.
     Record the split and why, and note that the sentinel range is a
     presentation filter, not a data-validity one.

2. Call sites
   - `drivers.ts:35` → `activeDriverFilter()`
   - `reference-data.ts:64` → `activeDriverFilter()`
   - `driver-planning.ts:64` → `availabilityDriverFilter('d')`

3. Tests (TDD — write/adjust first, watch them fail, then flip the source)
   - New `driver-filter.test.ts`: `activeDriverFilter` emits no `NOT IN`;
     `availabilityDriverFilter` does; prefix threading works for both.
   - `drivers.test.ts:71` — invert: assert `ACTIVE = 'Y'` present **and**
     `NOT IN (99994` absent. Update the stale lockstep comment.
   - `driver-planning.test.ts:134` — unchanged assertions, but update the
     lockstep comment to say the exclusion is Availability-only.
   - `reference-data.test.ts` — add the same `ACTIVE = 'Y'` / no-`NOT IN`
     assertion on the drivers recordset SQL if the batch SQL is asserted there.

4. Gate: `npm run typecheck && npm test` (api + domain at minimum). e2e specs
   under `apps/e2e/tests/browser/longhaul/availability.spec.ts` are unaffected —
   the Availability query is byte-identical.

## Out of scope

- Deciding which of 99994/99996/99997/99998/99999 are genuine. Not needed under
  this approach and not answerable without a live read of the view.
- Any change to `TYPE`/`NWSUB` handling. Nothing reads it today.
