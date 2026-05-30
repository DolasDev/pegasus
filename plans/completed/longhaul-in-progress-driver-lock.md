# longhaul: re-implement the legacy "In-Progress trip locks the driver field"

## Context

The legacy Electron app gated the driver-typeahead on the pending-trip /
planning view: once a trip's status reached **In-Progress**, the driver field
became read-only (you can't reassign a driver mid-haul). The current port
doesn't carry that lock:

- `containers/PendingTrips/index.tsx` → `DriverTripDetail` renders the
  typeahead unconditionally — no `isInProgress` check.
- `containers/Trip/index.tsx` (the trip-detail page) never shows a driver-edit
  affordance, so the trip-detail surface is _de facto_ read-only, but only by
  structural omission, not by an explicit lock.

This is a missing-feature-parity gap, not a bug per se — the QA workflow today
doesn't depend on it, but a dispatcher reassigning a driver on an In-Progress
trip will silently succeed.

## Why this is a backlog item, not a phase

- Needs a product call: should the lock exist? Legacy behavior says yes; the
  team may decide the port can do without it.
- If the answer is yes, the implementation is small (a `currentTrip.status` /
  `isInProgress` check + a read-only display branch in `DriverTripDetail`).
- Should ship alongside a spec in
  `apps/e2e/tests/browser/longhaul/trip-detail.spec.ts` (the `test.fixme`'d
  test that this backlog item replaces — see the comment block at the bottom
  of that file).

## When to act

- During the next driver-planning feature pass — bundle this with whatever
  other planning-side change is happening so we ship one product behavior
  change, not two.
- Or sooner if a dispatcher actually reassigns an In-Progress driver and we
  realise we want the lock.

## Acceptance

- `containers/PendingTrips/.../DriverTripDetail` renders a read-only display
  (driver name + a "locked" affordance) when `currentTrip.status?.status ===
'In-Progress'`.
- E2E spec: load Planning with `?tripId=` for an In-Progress trip, assert the
  driver typeahead is non-interactive (or replaced by the read-only display).
- Decision (drop / implement) is recorded as a one-liner in
  `dolas/agents/project/DECISIONS.md`.
