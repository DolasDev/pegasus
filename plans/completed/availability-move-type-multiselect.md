# Combine the three move-type filters into one multi-select

## Goal

Replace the three independent Any/Yes/No selects (Local, Long Dist., Shorthaul)
on the Availability screen (`/driver-planning`, View A) with **one multi-select
control**, so any combination of the three groups can be displayed together.

**Default: Long Dist. selected**, so long-distance drivers are what the page
shows on load.

## Decisions (user-confirmed)

- **Control:** multi-select dropdown (react-select `isMulti`), matching the Zone
  control beside it. Selections render as removable chips.
- **Semantics: OR / union.** Selecting Local + Shorthaul shows drivers who are
  either. This is the point of the change — the three old filters ANDed together,
  which could not express "show me these two groups together".
- **Empty selection = show all drivers** (no filter), matching the adjacent Zone
  filter's behavior.

## Deliberate consequence: negation is dropped

The old control could express `Local = No` (exclude local drivers). A set of
checkboxes cannot. This is an accepted trade for the union behavior that was
asked for — worth stating because it is a real capability removal, not an
oversight. If exclusion is ever needed it would want its own control.

Note the interaction with "empty = show all": a driver with **all three flags
false** is only visible when nothing is selected. That falls out of union
semantics and is the reason empty means "no filter" rather than "match nothing".

## Changes

1. **`AvailabilityViewA.tsx`**
   - Delete `type MoveTypeFilter`, `moveTypeMatches()`, and the three
     `useState<MoveTypeFilter>` hooks + their three `<select>` blocks.
   - Add `MOVE_TYPE_OPTIONS` (`local` / `longDistance` / `shorthaul` → labels
     `Local` / `Long Dist.` / `Shorthaul`) and a `moveTypeMatchesAny(d, selected)`
     helper: `selected.length === 0 || selected.some(o => d[flagOf(o)])`.
   - One `useState` seeded with the Long Dist. option.
   - One `<Select isMulti placeholder="Move Type">` in a
     `data-testid="move-type-filter"` wrapper, mirroring `driver-zone-filter`.
   - Swap the two predicate lines in the `visible` useMemo for one; fix the dep
     array.

2. **`apps/tenant-web/src/routes/driver-planning.index.test.tsx`**
   - Rewrite the `move-type filters` describe block. Drive react-select the way
     the existing zone test does (`mouseDown` + `focus` on the `combobox`, then
     click the option text) — `fireEvent.change` does not work on it.
   - Cover: **default shows only long-distance drivers**, single selection,
     two selections showing the union, and cleared = all drivers.
   - Only the four fixtures inside this block set `isLongDistance: false`
     (verified), so the new default cannot silently hide rows in unrelated tests.
     `makeDriver`'s base is `isLongDistance: true`.

3. **`apps/e2e/.../longhaul/pages/AvailabilityPage.ts` + `availability.spec.ts`**
   - The default filter changes what the QA specs see: they assert "≥1 driver
     row" and inline-edit rows, which would now silently run against the
     long-distance subset (or an empty table if QA data has no long-distance
     drivers). Add a `clearMoveTypeFilter()` page-object method and call it in
     `beforeEach` so the specs keep meaning "the full roster".

## Out of scope

- **No API change.** The handler already returns all three booleans; filtering
  stays client-side. No query params, no Zod, no SDK/OpenAPI surface.
- View B has no move-type filters and gets none.

## Verification — all green

- `npm run typecheck` (14/14) and `npm run lint`: clean.
- `apps/tenant-web`: 126 files / 1291 tests pass. No `vitest.config.ts`
  coverage-floor churn.
- Five rewritten unit tests cover the default, the union, a single non-default
  type, cleared-shows-all, and all-three ≠ none.
- **Browser-verified** against the real SPA (`vite --mode e2e`, API stubbed),
  6/6: the three old selects are gone; default chip is `Long Dist.` showing
  `[2, 3]`; adding Local unions to `[1, 2, 3]`; all three selected gives
  `[1, 2, 3, 4]` (excludes the no-group driver); cleared gives all five.

### jsdom note

`fireEvent.change` does nothing to react-select. The tests open the menu
(`mouseDown` + `focus` on the `combobox`) and click `.rs__option`, scoping by the
`classNamePrefix="rs"` class rather than by text — a selected value's label is
also rendered as a chip, so `getByText` is ambiguous. Chips are removed via
`.rs__multi-value__remove`. This mirrors the existing zone-filter test.
