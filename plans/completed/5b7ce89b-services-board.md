# Services board: rename + missing activity types

Branch: `fix/services-board-rename` (worktree `services-rename`)

## Request

1. Tenant app Operations > "Dispatch Activities": rename it to **Services**.
2. Reported: not all activity types show up in the list.

## Diagnosis (measured on prod 2026-10-20, read-only via the mssql-executor)

- Ruled out: the activity-type dropdown. Every `Longhaul_ActivityType` row on NW (13),
  QMM (16) and RVS (13) has a distinct, non-null abbreviation, so
  `toActivityTypeOptions` drops nothing.
- Cause: the board bounded its date range on `estimated_date`. That column is the ETA,
  and only types with `isHasETA = 1` ever get one. On NW, PACK, LOAD, XPU and R19I are
  `isHasETA = 0`: 13,831 of 13,897 PACKs and 14,176 of 14,235 LOADs have a NULL
  `estimated_date`. Those types could never appear on the board.

## Fix

- API `activities-list.ts`: filter, sort and project
  `COALESCE(estimated_date, planned_start) AS scheduled_date`. This is the same fallback
  the Gantt's ArrivalWindowField uses. It is a point date, so the #619/#622 overlap
  trap does not apply.
- tenant-web: the nav label and lane title now read "Services". The card's Date
  column renders `scheduled_date`, and the Date header sorts on `scheduled_date`.
- Route path, feature dirs and redux slice names are unchanged.

## Verification

- The new projection and WHERE were run against NW prod for 2026-10-20..27:
  Pack 48, Load 46, Deliver 43, APU-Out 9, CFA 8, SIT-In 8, CFD 2, APU-In 1 (165 rows,
  under the 1000-row cap). Under the old `estimated_date` predicate Pack, Load and
  APU-In were all 0.
- API and tenant-web unit tests and typecheck all pass.
