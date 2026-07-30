# Fix: Trip-detail Notes panel not visible (clipped off-screen right)

## Scope

`apps/tenant-web` only — driver-planning Trip-detail CSS. No API/domain changes.
Route affected: `/driver-planning/trips/:tripId` (and rejected-trip read-only view).

## Root cause (to confirm in browser first)

- `.noteContainer` (`apps/tenant-web/src/features/driver-planning/containers/Trip/Trip.module.css:57`)
  is `position: absolute; right: 10px` with no `top`. It pins to the right edge of its nearest
  positioned ancestor — the `Lane` `.container` (`position: relative`), width driven by
  `.tripContainer { width: calc(100vw - 90px) }` (`Trip.module.css:8`).
- `calc(100vw - 90px)` is a leftover from the standalone longhaul app (full viewport minus a 90px
  rail). Inside tenant-web's AppShell the content column is narrower, so `.tripContainer` overflows
  to the right, taking the right-pinned notes panel with it.
- Commit `400bb69` ("restore driver-planning headings/font stripped by Tailwind Preflight" — the
  "broader UI fixes") added `.driver-planning-root { position: relative; overflow-x: clip }` (in
  `apps/tenant-web/src/features/driver-planning/styles.css`) to hide the off-screen `ShipmentDetail`
  slide. That `overflow-x: clip` now also clips the over-wide `.tripContainer` right edge — and the
  notes panel with it. The notes render in the DOM (`[data-target="trip-notes"]`) but sit outside
  the visible/clipped area.

## Step 1 — Reproduce & confirm (browser, before any change)

- Use the `apps/tenant-web:verify` skill to drive the SPA to a trip-detail page with a trip that has
  notes (stub the API at the network layer).
- Confirm `[data-target="trip-notes"]` exists in the DOM but its bounding box's right edge is beyond
  `.driver-planning-root`'s clipped content box (i.e. off-screen right).
- Confirm `.tripContainer` computed width exceeds its parent content column width (the smoking gun).
  If the mechanism differs, update this plan before fixing.

## Step 2 — Fix (minimal, confirm each against the browser)

Preferred (single-line, smallest blast radius):

- Change `.tripContainer` width from `calc(100vw - 90px)` to fill its actual column, e.g.
  `width: 100%` (or `max-width: 100%` guard), so `right: 10px` on `.noteContainer` lands inside the
  visible area.
- Verify the Trip Itinerary / `ActivityGantt` still scrolls horizontally as before (the Gantt is the
  main reason the container was over-wide) — the Lane `.container` is `overflow: auto`, so inner
  content wider than the column should still scroll, not clip.

Fallback if width change disturbs the Gantt/itinerary:

- Keep `.tripContainer` width but re-anchor `.noteContainer` so it's pinned within the visible column
  (e.g. relative to a guaranteed-visible ancestor, or reposition into normal flow at top-right).

## Step 3 — Regression guard

- Extend the existing deterministic visual spec `apps/e2e/tests/browser/trip-date-container.spec.ts`
  (added in `400bb69`, WEB_URL-gated) with an assertion that `[data-target="trip-notes"]` is visible
  and its bounding box is within `.driver-planning-root`'s content box.
- `Trip/index.test.tsx` already asserts Notes renders; keep it green.

## Verification / done criteria

- Notes panel visible on trip-detail in the browser (verify skill) at normal AppShell width.
- Gantt/itinerary horizontal behavior unchanged.
- `npm run typecheck`, tenant-web unit tests, and the trip-date-container browser spec pass.
- One PR, apps/tenant-web only.
