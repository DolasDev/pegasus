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

- [ ] Extend `packages/domain/src/__tests__/domain.test.ts`:
  - [ ] Import `roomTotalValue`, `toInventoryRoomId`, `toInventoryItemId` from `'../index'`
  - [ ] Add `roomTotalValue` describe block (4 cases — see below)
  - [ ] Import `DomainError` from `'../shared/errors'`
  - [ ] Add `DomainError` describe block (3 cases — see below)
- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/domain` — all tests pass

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
