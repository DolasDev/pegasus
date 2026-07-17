# Driver Availability — View A fine-tunes

## Context

Follow-up to the View A restructure (PR #462, shipped). Four visual/interaction
refinements to Availability **View A** of driver-planning, borrowing established
patterns from View B and View C. All changes are confined to
`apps/tenant-web/src/features/driver-planning/availability/AvailabilityViewA.tsx`
plus its tests in `apps/tenant-web/src/routes/driver-planning.index.test.tsx`.
Port helpers verbatim from the sibling views — divergence between A/B/C is by
design, so copying (not sharing) is the house style.

## Changes

### 1. Agency color-highlight + tooltip on the Driver name (from View B)

Port from `AvailabilityViewB.tsx`:

- Constants `AGENCY_PLACEHOLDER = '1111'`, the `AGENCY_BG` record (agent code →
  `bg-*` class), and `agencyBgClass(agentCode)` (View B lines 36–51).
- In `DriverRow`, add `const agency = driver.agentCode ?? AGENCY_PLACEHOLDER`.
- Apply `agencyBgClass(driver.agentCode)` to the `driver-name` `TableCell`'s
  className and add `data-agency={agency}`. Wrap the **name span** in
  `<HoverToolTip content={\`Agency: ${agency}\`} direction="top">` (View B 417–425).
- **Keep the name NOT bold** — the prior task deliberately un-bolded it; this
  request adds only color + tooltip, so do not re-add `font-bold`.

### 2. Delivery-row rework (in `DeliveryLine`)

Current row order: `icon | date | state | city` (4 `<td>`s). New order:
`date | state | icon` (3 `<td>`s):

- **Remove the city `<td>`.** Move the city to a **tooltip on the state**: wrap
  the state in `<HoverToolTip content={titleCaseCity(delivery.city)} direction="top">`
  when a city exists. Because `HoverToolTip` only renders content on hover (400ms
  timer — see `containers/ToolTips/index.tsx`), also put a testable/accessible
  hook on the state `<td>`: `data-city={titleCaseCity(delivery.city)}` (and keep
  it absent/empty when there's no city). `titleCaseCity` already exists in View A.
- **Move the indicator icon from first to last position** (after state).
- **Color-code the icon from View C** (`AvailabilityViewC.tsx` `getConfidenceTier`,
  lines 95–110): `actualDate → text-emerald-700`, `isConfirmed → text-emerald-600`,
  `isCommitted → text-emerald-500`. View A additionally has a **spread**
  (`fa-question`) tier that View C lacks — color it `text-muted-foreground`
  (least-certain → muted). Update View A's `getConfidenceTier` colorClass values
  accordingly and drop the now-stale "no per-tier hue" comment.

### 3. Move phone + chat-bubble icons in FRONT of the driver name

In the `driver-name` cell, reorder the inline-flex so the two `<a>` quick-action
anchors (`driver-call`, `driver-sms`) render **before** the name span (currently
after). Combine with change 1: `[phone][sms] [tooltip-wrapped name]`.

### 4. WGS color coding (in `wgsCell`)

Add a helper `wgsColorClass(v: boolean | null)`:

- `true` → `text-green-600 font-bold` (green + bold)
- `false` → `text-red-400 font-bold` (muted red + bold)
- `null` → `''` (unchanged / unset formatting preserved)

Append it to the existing `wgsCell` `TableCell` className
(`cursor-pointer select-none text-center text-base ...`).

## Tests (`driver-planning.index.test.tsx`, variant pinned to A via `Math.random → 0`)

Update the assertions that encode the old layout, and add coverage for the new
behavior:

- **`'…icons trailing it'`** (~L205): rename to "…in front of it"; assert the
  `driver-call`/`driver-sms` nodes precede the name text within the `driver-name`
  cell (DOM order). Name still not `font-bold`.
- **New**: agency highlight + tooltip — a driver whose `agentCode` is an
  `AGENCY_BG` key gets the bg class on the `driver-name` cell and `data-agency`
  set (mirror View B's agency test).
- **`'orders the shipment cells icon | date | state | city'`** (~L767): retitle to
  `date | state | icon`; assert `effIdx` first, `stateIdx === effIdx + 1`,
  `iconIdx === stateIdx + 1`; drop the city-cell assertion.
- **`'renders the state code and title-cased city (no bold)'`** (~L833): city is no
  longer inline — assert `'TX'` present, assert the state `<td>` carries
  `data-city="El Paso"`, and that plain (un-hovered) `textContent` no longer
  contains `'El Paso'`.
- **`'…planned-spread fallback'`** (~L869): change the icon color assertion from
  `text-[#0c145c]` to `text-muted-foreground`.
- **New**: delivery icon emerald color for actual/confirmed/committed
  (`text-emerald-700/600/500`), extending the existing data-icon tests.
- **New**: WGS color coding — `true` → green+bold, `false` → muted-red+bold,
  `null` → neither class (guards the merge-queue coverage-floor ratchet given the
  new branches).

## Verification

- `cd apps/tenant-web && npx vitest run src/routes/driver-planning.index.test.tsx` — green.
- `npm test` (full tenant-web suite) — green; `npm run typecheck` + `npm run lint` clean.
- Drive the SPA (`apps/tenant-web:verify` skill): View A shows agency-tinted driver
  cells with an "Agency: …" hover tooltip; phone/SMS icons sit before the name;
  delivery rows read date → state → colored icon, with the city surfacing on state
  hover; WGS renders green-bold / muted-red-bold / plain for Yes / No / Maybe.
