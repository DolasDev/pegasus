# Plan: Domain unit test gaps

**Branch:** main
**Goal:** Add missing unit tests for `roomTotalValue` and `DomainError`.

## Context

The domain test suite in `packages/domain/src/__tests__/domain.test.ts` and
`packages/domain/src/index.test.ts` covers all major domain functions **except**:

- `roomTotalValue` (`inventory/index.ts:69`) — never imported into any test file.
- `DomainError` (`shared/errors.ts:11`) — the base error class is never exercised.

Everything else (`canTransition`, `isQuoteValid`, `canDispatch`, `canFinalizeQuote`,
`calculateQuoteTotal`, `calculateInvoiceBalance`, `canVoidInvoice`, `dateRangesOverlap`,
`hasPrimaryContact`, `createMoney`, `addMoney`, `validateAddress`, `dateRangesOverlap`) is
already tested.

## Checklist

- [x] Extend `packages/domain/src/__tests__/domain.test.ts`:
  - [x] Import `roomTotalValue`, `toInventoryRoomId`, `toInventoryItemId` from `'../index'`
  - [x] Add `roomTotalValue` describe block (5 cases)
  - [x] Import `DomainError` from `'../shared/errors'`
  - [x] Add `DomainError` describe block (3 cases)
- [x] Run `node node_modules/.bin/turbo run test --filter=@pegasus/domain` — all 56 tests pass

## Test cases

### `roomTotalValue`

```
describe('roomTotalValue', () => {
  it('returns zero for a room with no items')
  it('sums quantity × declaredValue.amount for a single item')
  it('sums multiple items')
  it('skips items without a declaredValue')
  it('skips items whose declaredValue currency does not match the requested currency')
})
```

### `DomainError`

```
describe('DomainError', () => {
  it('is an instance of Error')
  it('sets name to DomainError')
  it('exposes the code passed to the constructor')
})
```

## Files modified

- `packages/domain/src/__tests__/domain.test.ts`

## Side effects / risks

None — purely additive, no production code changes.

## Verification

```bash
node node_modules/.bin/turbo run test --filter=@pegasus/domain
```
