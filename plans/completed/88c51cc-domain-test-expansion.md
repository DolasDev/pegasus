# Domain Package Test Expansion

**Branch:** `feature/domain-test-expansion`
**Goal:** Expand domain test coverage from 2 files to comprehensive per-context tests, targeting 90%+ statement coverage.

## Context

The domain is "the heart of the system" with only 2 test files (~455+154 lines). The `canTransition` state machine tests 7 of 25 possible transitions. Missing exhaustive state machine coverage, boundary cases, and edge cases.

## Implementation Checklist

### 1. Dispatch tests — exhaustive state machine

- [x] Write test: `packages/domain/src/dispatch/__tests__/dispatch.test.ts`
  - All 25 `canTransition` state transitions (parameterized)
  - `canDispatch` edge cases
  - Move creation validation

### 2. Quoting tests — boundary cases

- [x] Write test: `packages/domain/src/quoting/__tests__/quoting.test.ts`
  - `isQuoteValid` at exact expiration boundary
  - `calculateQuoteTotal` edge cases (empty items, single item, many items)
  - Quote immutability after acceptance

### 3. Billing tests — edge cases

- [x] Write test: `packages/domain/src/billing/__tests__/billing.test.ts`
  - `calculateInvoiceBalance` with zero, one, multiple payments
  - `canVoidInvoice` for all invoice statuses
  - Invoice generation from quote

### 4. Shared types tests — dateRange edges

- [x] Write test: `packages/domain/src/shared/__tests__/types.test.ts`
  - `dateRangesOverlap` — identical ranges, zero-length, adjacent, contained
  - Money arithmetic edge cases
  - Branded type construction

### 5. Verify

- [x] `npm test` — all pass (219/219 tests pass across 7 test files)
- [x] `npm run typecheck` — no new type errors
- [ ] Domain coverage exceeds 90% statements, 85% branches

## Files

| Action | Path |
|--------|------|
| Create | `packages/domain/src/dispatch/__tests__/dispatch.test.ts` |
| Create | `packages/domain/src/quoting/__tests__/quoting.test.ts` |
| Create | `packages/domain/src/billing/__tests__/billing.test.ts` |
| Create | `packages/domain/src/shared/__tests__/types.test.ts` |

## Risks / Side Effects

- Test-only change — no production code modified
- May reveal existing bugs in domain logic (treat as signal)

## Dependencies

None — can start immediately.
