# Property-Based Testing for Domain Value Objects

**Branch:** `feature/on-prem-server`
**Goal:** Property-based tests using fast-check for Money, DateRange, and branded ID types to discover edge cases humans miss.

## Context

Money, DateRange, and branded IDs are fundamental domain types. Property-based tests catch subtle arithmetic bugs (floating-point) and boundary conditions that example-based tests miss.

## Implementation Checklist

### 1. Install fast-check

- [x] `npm install -D fast-check` in `packages/domain`

### 2. Property-based test suite

- [x] Write test: `packages/domain/src/shared/__tests__/properties.test.ts`
  - `addMoney` commutativity: `addMoney(a, b).amount === addMoney(b, a).amount`
  - `addMoney` associativity
  - `addMoney` identity (zero element)
  - `createMoney` non-negative: `createMoney(amount)` rejects negative
  - `createMoney` accepts non-negative
  - `addMoney` throws on currency mismatch
  - `dateRangesOverlap` reflexivity: any range overlaps itself
  - `dateRangesOverlap` symmetry: `overlap(a, b) === overlap(b, a)`
  - Disjoint ranges do not overlap
  - Overlapping ranges are detected
  - Properties hold for 1000+ random inputs

### 3. Verify

- [x] `npm test` — all 219 tests pass (11 new property tests added)
- [x] `npm run typecheck` — no new type errors

## Files

| Action | Path |
|--------|------|
| Create | `packages/domain/src/shared/__tests__/properties.test.ts` |
| Modify | `packages/domain/package.json` (fast-check devDependency) |
| Modify | `packages/domain/vitest.config.ts` (exclude dist/** from test discovery) |

## Notes

- `fc.date()` without `noInvalidDate: true` can shrink to `new Date(NaN)` — fixed by adding the flag
- Pre-existing issue: vitest was picking up compiled `dist/**/*.test.js` artifacts; fixed by adding `exclude: ['dist/**']` to vitest config
- `@vitest/coverage-v8` was auto-added during Stryker install; moved to devDependencies

## Risks / Side Effects

- `fast-check` install modifies `packages/domain/package.json` and local `package-lock.json`
- Test-only change — no production code modified

## Dependencies

- **Task 5 (domain-test-expansion)** — baseline domain coverage should exist first so property tests complement rather than replace example tests.
