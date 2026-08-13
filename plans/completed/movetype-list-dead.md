# Delete the dead MOVETYPE_LIST

## Problem

`apps/tenant-web/src/features/driver-planning/utils/movetype-list.ts` exports
`MOVETYPE_LIST`, a hardcoded move-type option list. **Nothing consumes it** — the
only importer is its own test (`movetype-list.test.ts`), so the test asserts
that a constant equals itself and nothing else exercises the module. Verified by
repo-wide grep across `.ts/.tsx/.js/.json` (excluding `node_modules`, `dist`):

```
movetype-list.test.ts:2:import { MOVETYPE_LIST } from './movetype-list'
movetype-list.ts:1:export const MOVETYPE_LIST = [
```

The real Move Types dropdown is served by the API — `filter-options.ts` /
`reference-data.ts` query the legacy `MoveType` lookup, filtered by the
per-client `moveTypesWhere` — and rendered by `FilterTabs` from
`filterOptions.moveType`.

It is not merely unused, it is **misleading**. It lists 5 codes (H, HA, A, M,
SS) with labels that do not match the lookup — `Interstate` vs the real
`HHG INTERSTATE`, `Auto Only` vs `AUTO ONLY` — and omits 11 of the 16 codes NWI
actually offers, including every code #628 just made reachable (OA, DA, LC, I,
L, P, SP, C, TC, OF) and INTERNATIONAL. Anyone who found it while working on
move types would be reading a stale, partial mirror of the real list. Flagged as
a deletion candidate in `dolas/agents/project/GOTCHAS.md` since #615.

## Tasks

1. Delete `apps/tenant-web/src/features/driver-planning/utils/movetype-list.ts`
   and its test `movetype-list.test.ts`.
2. Drop the "don't extend it" bullet from the GOTCHAS entry — once the file is
   gone the warning has no referent; note the deletion instead so the advice
   doesn't get re-derived.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` — a missed importer surfaces as
a compile error, which is the real check that the grep was complete.
