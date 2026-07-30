# Remove Availability Variant C; default to View A (no random)

## Ask

In the driver availability screen (`/driver-planning`), remove Variant C entirely and
drop the random variant selection — always render **View A** first.

## Interpretation

`/driver-planning` (`routes/driver-planning.index.tsx`) currently mounts one of three
A/B-test variants at random per load, with a "Change View" A/B/C tab control. The ask:

- Delete Variant C (component + all references).
- Remove `pickRandomVariant` / `Math.random` selection.
- Default the mounted variant to **A**.

**Kept:** the "Change View" tab control and **Variant B** — the ask says render A
_first_, and only names C for removal. So the selector stays with two tabs (A default,
B switchable). (Note for reviewer: View A has already absorbed View B's roster columns,
so B is arguably a future removal candidate too — out of scope here unless asked.)

## Changes

### 1. Route — `apps/tenant-web/src/routes/driver-planning.index.tsx`

- Drop the `AvailabilityViewC` import.
- `VariantKey = 'A' | 'B'`; `VARIANTS = [A, B]`.
- Delete `pickRandomVariant`.
- `const [variant, setVariant] = useState<VariantKey>('A')`.
- Update the header comment (no longer random; A is the default).

### 2. Delete `apps/tenant-web/src/features/driver-planning/availability/AvailabilityViewC.tsx`

### 3. Unit tests — `apps/tenant-web/src/routes/driver-planning.index.test.tsx`

- Remove the top-level `vi.spyOn(Math, 'random').mockReturnValue(0)` (random is gone; A
  is the default — nothing to pin).
- **Variant B block:** it currently mounts B via `mockReturnValue(0.5)`. Replace with an
  explicit switch to B. Preferred: a `renderVariantB(state?)` helper = `renderPage` then
  `fireEvent.click(getByTestId('availability-view-tab-B'))` (the real user flow now).
  Fall back to rendering `<AvailabilityViewB />` directly if the Radix tab click doesn't
  switch under jsdom — verify empirically.
- **Delete** the `describe('Variant C linked ready date', …)` block added in #486.
- **Add** a page-level test: default render shows View A (assert an A-only header e.g.
  `Ready City` / `Deliveries`), the C tab is gone (`queryByTestId('availability-view-tab-C')`
  is null), and tabs A + B are present.

### 4. E2E page object — `apps/e2e/tests/browser/longhaul/pages/AvailabilityPage.ts`

- `pinVariant` default `'A'`; narrow the type to `'A' | 'B'`.
- Rewrite the VARIANT NOTE / comments: no random; A is default; the linked
  date/state/city edit model lives in A (identical testids).

### 5. E2E spec — `apps/e2e/tests/browser/longhaul/availability.spec.ts`

- `beforeEach`: `pinVariant('A')`; drop the "re-randomises per mount" language.
- Reload re-pins → `pinVariant('A')` (A is default, so this is belt-and-suspenders).
- **Columns test:** swap to View A's headers, dropping the C-only "Current Trip". Assert
  an unambiguous subset present in A: `Driver, Ready Date, Ready State, Ready City,
Deliveries, Notes` (substring/role match; none is a substring of another).
- **"current-trip cell" test:** View A has no `driver-current-trip` cell — the trip link
  moved into the Deliveries cell (`deliveries-trip-link`, present only when the driver
  has a `currentTripId` and shipments). Rewrite to: if a `deliveries-trip-link` exists in
  the first row, assert its `href` matches `/driver-planning/trips/\d+`; otherwise skip
  (unassigned / no shipments). Keeps the navigation-affordance intent against A.

## Out of scope

- Variant B and the tab control stay.
- No change to the edit/commit logic (the #486 clear fix stays as-is in A).
- No API/SQL/redux change.

## Verification

- `typecheck`, `lint` green (incl. `@pegasus/e2e:typecheck` for the retargeted specs).
- Unit: full `driver-planning.index.test.tsx` green — A tests unchanged, B tests switch
  via the tab (or direct render), the new default-A/no-C test passes, C block gone.
- Full tenant-web suite green.
- Grep confirms zero remaining `AvailabilityViewC` / `availability-view-tab-C` /
  `pickRandomVariant` references.
- E2E specs typecheck (they run against QA remotely, gated on on-prem health).
