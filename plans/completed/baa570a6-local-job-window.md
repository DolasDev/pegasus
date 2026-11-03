# Itinerary: local job arrival window from the crew start time; ETA midnight sentinel

**Status:** SHIPPED (this PR). **Branch:** `fix/local-job-window` (worktree `../pegasus-local-job-window`).
Approved by Steve 2026-10-30: "fix the ETA sentinel as a workstream; the crew's start time is
equivalent to the trip activity's arrival window".

## Context

NW live check 2026-10-28 (read-only, the API's real `fetchItinerary` through the prod executor):
`LocalDispatchJobs.eta_minimum` is never NULL — "no ETA set" is stored as `1900-01-01 00:00`, and
`eta_maximum` = that + `eta_win_minutes`. No ETA anywhere falls 1–5 am, so midnight is not a real
time. `local-job-tokens.ts` mapped it to `arrivalWindow = 00:00 – 01:00`. Affected (active jobs with
a driver, −90..+30 days): NW 195/1952, QMM 523/1407, RVS 3/686.

movemanager (`LocalDispatchJobMaster.vb` + `LoHiConverters_LocalDispatchJobOld.vb`) keeps TWO
windows on a job's Schedule:

- **Job window** — `JobStartTime` = `start_time`, `JobWindowInMinutes` = `minutes`,
  `JobEndTime` = start + minutes (persisted as `end_time`). Filled on every job (default 8:00 AM).
- **ETA window** — `ETAMinimum` = `eta_minimum`, `ETAWindowInMinutes` = `eta_win_minutes`,
  `ETAMaximum` = min + minutes. Used in the customer "Arrival Time" email.

Data (−90..+30 days, active jobs with a driver): `start_time` is a single time almost always
(`end_time <> start_time` NW 134/1919, QMM 0/1406, RVS 1/678; `minutes` non-zero on the same rows);
start at 00:00 only QMM 5. A real ETA (not midnight) is on NW 1713, QMM 889, RVS 675 jobs and
differs from the start time on NW 264, QMM 118, RVS 502 — e.g. NW crew 11319 starts 08:00 on every
job while its ETAs are 08–10, 10–12, 11–13 per stop.

**Decision (Steve, 2026-10-30, shown the data above):** "ETA, start as fallback" — a local item's
`arrivalWindow` is the dispatcher ETA window when one is set; when `eta_minimum` is the midnight
sentinel, the job window (`start_time` → `end_time`) instead. No contract change. (His first
answer: "the crew's start time is equivalent to the trip activity's arrival window".)

## Checklist

- [x] `lib/itinerary/local-job-tokens.ts`: `LocalJobRow` gains `start_time`, `end_time`;
      `arrivalWindow` = ETA when `eta_minimum` is not 00:00, else start→end (end missing or before
      start ⇒ end = start); a 00:00 start too ⇒ null. Tests.
- [x] Both local SELECTs add `j.start_time, j.end_time`: `fetch.ts` and
      `services-board-local.ts` (they share `LocalJobRow`).
- [x] Mobile `formatWindow`: a window whose start = end renders as one time ("08:00"). Test.
- [x] Re-ran the live check with the worktree's code (busiest 3 crews each on NW, QMM, RVS): no
      `00:00` window anywhere; NW crew 3097 (26/27 items `00:00–01:00` before) now shows its crew
      start times (07:00–09:00, 14 of them a single 08:00); real ETAs pass through unchanged. One QMM
      ETA reads 21:00–22:30 — dispatcher-entered, left as is.
- [x] GOTCHAS: the midnight sentinel + the two windows on a local job.

## Risks

- Contract change on `/me/itinerary` and `/drivers/itinerary`: additive field only. The mobile
  build in the field (none yet with the itinerary) is unaffected.
- Deploy order: API first, then the EAS build (mobile reads the new field defensively anyway).
