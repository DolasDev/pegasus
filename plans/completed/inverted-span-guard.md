# Fix: the inverted-span guard from #619 rejects legitimate data

## What's wrong

#619 added `isInvertedSpan` and used it to reject `planned_end < planned_start` with a 400 on
both write paths (`activities-write.ts`, `longhaul-trip-save.ts`). The justification was that
every such row in prod was a wrong-year typo.

That premise is false. Per the domain owner: **a plan date may legitimately fall outside the
date spread, and an actual date may legitimately precede the planned date.** For an RDEL
activity `peg-dates.ts` maps

```
plannedStart = shipment.del_date2 || shipment.plan_del
plannedEnd   = shipment.plan_del  || shipment.del_date2
```

so `plan_del` earlier than `del_date2` — legitimate — makes `planned_end < planned_start`.

**Live impact:** 8 activities in NWI prod carry a legitimately inverted pair (orders 418693,
416861, 421125, 426152, 437584, 441297, 451441, 460782). Editing an ETA/actual on any of them
now 400s, because the guard re-checks the _effective_ span using the stored bounds even when the
PATCH only touches `estimated_date`. Worse, `computeTripSavePlan` fails the **whole trip save**
with VALIDATION_ERROR, so those trips cannot be saved at all.

## Fix

1. **Delete the inverted-span rejection** from both write paths and drop `isInvertedSpan`. It
   encodes a false domain rule.
2. **Replace it with the guard that is actually justified: an implausible-year check.** The real
   defect class was never "inverted" — it was sentinel/typo years (1952, 1960, 1961, 1969, 1971,
   2000, 2001, 2012). Every legitimate row in the table is 2020 or later. Reject a date-only
   column whose year falls outside `[2015, currentYear + 5]`, which catches all eight sentinel
   shapes and no real data.
3. Keep everything else from #619 — the date-only normalization is unaffected and correct.

## Tests (red first)

- `longhaul-date-only.test.ts` — drop the `isInvertedSpan` suite; add `isImplausibleDateOnly`
  covering 1969/1952/2000/2012 as rejected and 2020..currentYear+5 as accepted, including the
  boundary years.
- `activities-write.test.ts` — replace "rejects an inverted span with 400" with **"accepts a
  legitimately inverted span"** (the regression this fixes) plus "rejects an implausible year".
- `longhaul-trip-save.test.ts` — same inversion: an inverted planned span now yields a plan, not
  a guard error; an implausible year still errors.

## Note

The prod data cleanup already run (#619 follow-up) stands: the wrong-year rows it fixed were
corroborated by same-MM/DD-one-year-apart evidence, not by the inverted-span heuristic. The 8
CAT3 rows above were deliberately left alone and are now understood to be legitimate — they
need no repair.
