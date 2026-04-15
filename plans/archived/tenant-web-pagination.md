# Plan: Enable pagination in tenant-web + add total count to API

**Branch:** TBD (create from main)
**Goal:** Export `fetchPaginated` in tenant-web, add `total` count to API list endpoints, and wire up pagination in query hooks.

## Problem

1. tenant-web only exports `apiFetch` — not `fetchPaginated`. List endpoints return `{ data, meta }` but meta is silently discarded.
2. API list endpoints return `meta.count = data.length` (items in this page), not the total row count. `PaginationMeta` in `@pegasus/api-http` defines `total` but the API never sends it.
3. No frontend can show "page X of Y" or detect the last page.

## Checklist

### Step 1 — Add total count to API list endpoints (TDD)

- [ ] Write test in `apps/api/src/handlers/customers.test.ts`: GET `/` returns `meta.total` as the total count (not just page size). Mock `listCustomers` to return 3 items and mock a new `countCustomers` to return 10.
- [ ] Write test in `apps/api/src/handlers/moves.test.ts`: same pattern for moves
- [ ] Add `countCustomers(db, opts)` to `apps/api/src/repositories/customer.repository.ts` — returns `db.customer.count()`
- [ ] Add `countMoves(db, opts)` to `apps/api/src/repositories/move.repository.ts`
- [ ] Repeat for quotes, billing, inventory repositories
- [ ] Update handler list endpoints to call count function and include `total` in meta:
  - `apps/api/src/handlers/customers.ts` — `meta: { total, count: data.length, limit, offset }`
  - `apps/api/src/handlers/moves.ts`
  - `apps/api/src/handlers/quotes.ts`
  - `apps/api/src/handlers/billing.ts`
  - `apps/api/src/handlers/inventory.ts`
- [ ] Update `apps/api/src/repositories/index.ts` barrel to export new count functions
- [ ] Tests pass

### Step 2 — Export fetchPaginated in tenant-web

- [ ] Write test in `apps/tenant-web/src/api/client.test.ts`: `apiFetchPaginated` injects correlation-id and returns `{ data, meta }` (mirror admin-web's existing test)
- [ ] Update `apps/tenant-web/src/api/client.ts`:
  - Import `PaginationMeta` from `@pegasus/api-http`
  - Export `apiFetchPaginated` bound to `client.fetchPaginated`
- [ ] Test passes

### Step 3 — Update tenant-web query hooks to use fetchPaginated for lists

- [ ] `apps/tenant-web/src/api/queries/customers.ts` — `customersQueryOptions` uses `apiFetchPaginated<Serialized<Customer>>` and returns `{ data, meta }`
- [ ] `apps/tenant-web/src/api/queries/moves.ts` — same
- [ ] `apps/tenant-web/src/api/queries/quotes.ts` — same
- [ ] `apps/tenant-web/src/api/queries/billing.ts` — same
- [ ] `apps/tenant-web/src/api/queries/inventory.ts` — same
- [ ] Update route files that consume list queries to handle `{ data, meta }` shape instead of bare arrays

### Step 4 — Verify

- [ ] `node node_modules/.bin/turbo run test`
- [ ] `node node_modules/.bin/turbo run typecheck`

## Files modified

- `apps/api/src/repositories/customer.repository.ts` (add count)
- `apps/api/src/repositories/move.repository.ts` (add count)
- `apps/api/src/repositories/quote.repository.ts` (add count)
- `apps/api/src/repositories/billing.repository.ts` (add count)
- `apps/api/src/repositories/inventory.repository.ts` (add count)
- `apps/api/src/repositories/index.ts` (export counts)
- `apps/api/src/handlers/customers.ts` (add total to meta)
- `apps/api/src/handlers/moves.ts`
- `apps/api/src/handlers/quotes.ts`
- `apps/api/src/handlers/billing.ts`
- `apps/api/src/handlers/inventory.ts`
- `apps/api/src/handlers/*.test.ts` (update list tests)
- `apps/tenant-web/src/api/client.ts` (export fetchPaginated)
- `apps/tenant-web/src/api/client.test.ts` (new tests)
- `apps/tenant-web/src/api/queries/*.ts` (5 files)
- `apps/tenant-web/src/routes/*.tsx` (route files consuming lists)

## Notes

- This plan depends on `wire-safe-response-types` if executed after it (query hooks will use `Serialized<T>`). Can be done independently if `Serialized<T>` isn't merged yet — just use the raw domain types for now.
- The count queries add a second DB round-trip per list request. For the current scale this is fine. If it becomes a concern, a single `findMany` + `count` can be combined into a Prisma `$transaction` for consistency.
