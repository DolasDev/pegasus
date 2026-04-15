# Plan: Define wire-safe response types for API → frontend

**Branch:** TBD (create from main)
**Goal:** Eliminate the `Date` vs `string` type lie across the API boundary by introducing `Serialized<T>` and using it in all frontend query hooks.

## Problem

Domain types have `createdAt: Date`, `updatedAt: Date`, `scheduledDate: Date`. JSON serialization turns these into strings, but frontends use `apiFetch<Customer>` which says it returns `Date`. The code already has runtime workarounds:

```ts
// apps/tenant-web/src/routes/moves.index.tsx:20-22
row.scheduledDate instanceof Date
  ? row.scheduledDate.toLocaleDateString()
  : String(row.scheduledDate).slice(0, 10)
```

Branded IDs (`CustomerId`, `MoveId`) are similarly phantom — they're plain strings over JSON.

## Approach (TDD)

1. Write type-level tests that verify `Serialized<Customer>` has `createdAt: string` (not `Date`)
2. Implement the utility type
3. Update frontend query hooks to use `Serialized<T>` instead of `T`
4. Remove all `instanceof Date` workarounds

## Checklist

### Step 1 — Add `Serialized<T>` utility type to domain package

- [ ] Write `packages/domain/src/shared/__tests__/serialized.test.ts` — type-level tests using `expectTypeOf` (Vitest):
  - `Serialized<Customer>` has `createdAt: string`, `updatedAt: string`
  - `Serialized<Move>` has `scheduledDate: string`
  - `Serialized<Customer>` has `id: string` (not `CustomerId`)
  - Nested arrays: `Serialized<Customer>` has `contacts[n].id: string` (not `ContactId`)
  - Non-date, non-branded fields are unchanged: `Serialized<Customer>` has `firstName: string`
- [ ] Implement `Serialized<T>` in `packages/domain/src/shared/types.ts`:
  - Recursively maps `Date` → `string`
  - Recursively maps `Brand<string, any>` → `string`
  - Preserves everything else
- [ ] Export from barrel: `packages/domain/src/index.ts`
- [ ] Verify type tests pass: `node node_modules/.bin/turbo run test --filter=@pegasus/domain`

### Step 2 — Update tenant-web query hooks

- [ ] `apps/tenant-web/src/api/queries/customers.ts` — change `apiFetch<Customer>` → `apiFetch<Serialized<Customer>>`, same for `Customer[]`
- [ ] `apps/tenant-web/src/api/queries/moves.ts` — `Serialized<Move>`, `Serialized<Move>[]`
- [ ] `apps/tenant-web/src/api/queries/quotes.ts` — `Serialized<Quote>`, etc.
- [ ] `apps/tenant-web/src/api/queries/billing.ts` — `Serialized<Invoice>`, etc.
- [ ] `apps/tenant-web/src/api/queries/inventory.ts` — `Serialized<InventoryRoom>`, etc.

### Step 3 — Fix compilation errors in route files

Changing query return types will cause TypeScript errors anywhere the code treats `createdAt` as `Date`. Fix each:

- [ ] `apps/tenant-web/src/routes/moves.index.tsx` — remove `instanceof Date` guard, use string directly
- [ ] `apps/tenant-web/src/routes/moves.$moveId.tsx` — same
- [ ] `apps/tenant-web/src/routes/settings.developer.tsx` — `new Date(client.createdAt)` is already correct (string → Date parse), no change needed
- [ ] Fix any other TypeScript errors surfaced by `tsc --noEmit`

### Step 4 — Update admin-web if it imports domain types

- [ ] Check admin-web for domain type imports and apply same pattern

### Step 5 — Verify

- [ ] `node node_modules/.bin/turbo run typecheck`
- [ ] `node node_modules/.bin/turbo run test`

## Files modified

- `packages/domain/src/shared/types.ts` (add `Serialized<T>`)
- `packages/domain/src/shared/__tests__/serialized.test.ts` (new)
- `packages/domain/src/index.ts` (export `Serialized`)
- `apps/tenant-web/src/api/queries/*.ts` (5 files)
- `apps/tenant-web/src/routes/moves.index.tsx`
- `apps/tenant-web/src/routes/moves.$moveId.tsx`

## Design notes

The `Serialized<T>` type lives in the domain package because:

- Domain owns the entity definitions
- The transformation is deterministic (JSON.stringify semantics)
- Both web apps and mobile will consume it
- It avoids a new package for one utility type

Alternative considered: response DTO types per entity (e.g., `CustomerResponse`). Rejected — too much boilerplate for a mechanical transformation. `Serialized<T>` is zero-maintenance as new fields are added.
