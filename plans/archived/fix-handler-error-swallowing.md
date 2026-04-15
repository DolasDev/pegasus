# Plan: Remove per-handler catch blocks that swallow errors

**Branch:** TBD (create from main)
**Goal:** Remove redundant try/catch blocks from all API handlers so errors bubble to the global `app.onError` handler, restoring DomainError → 422 routing and structured logging.

## Problem

Every handler wraps its body in `try { ... } catch { return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500) }`. This:

1. Prevents `DomainError` from reaching `app.onError`, turning business-rule violations into generic 500s
2. Suppresses structured logging — the catch has no `err` binding, so nothing is logged
3. Makes error paths untestable — every error looks identical
4. Duplicates what `app.onError` already does (and does better)

## Approach (TDD)

Write failing tests first that prove DomainError surfaces as 422, then remove the catch blocks to make them pass.

## Checklist

### Step 1 — Write failing tests for DomainError propagation

- [ ] `apps/api/src/handlers/customers.test.ts` — add test: when repository throws `DomainError`, handler returns 422 with `{ error, code }` (currently returns 500)
- [ ] `apps/api/src/handlers/moves.test.ts` — same pattern
- [ ] `apps/api/src/handlers/quotes.test.ts` — same pattern
- [ ] `apps/api/src/handlers/billing.test.ts` — same pattern
- [ ] `apps/api/src/handlers/inventory.test.ts` — same pattern
- [ ] `apps/api/src/handlers/orders.test.ts` — same pattern
- [ ] Verify all new tests FAIL (they return 500 instead of 422)

### Step 2 — Remove per-handler catch blocks

- [ ] `apps/api/src/handlers/customers.ts` — remove all `try { } catch { return c.json(500) }` wrappers, let handler body run unwrapped
- [ ] `apps/api/src/handlers/moves.ts` — same
- [ ] `apps/api/src/handlers/quotes.ts` — same
- [ ] `apps/api/src/handlers/billing.ts` — same
- [ ] `apps/api/src/handlers/inventory.ts` — same
- [ ] `apps/api/src/handlers/orders.ts` — same
- [ ] `apps/api/src/handlers/events.ts` — same
- [ ] `apps/api/src/handlers/api-clients.ts` — same
- [ ] `apps/api/src/handlers/settings.ts` — same
- [ ] `apps/api/src/handlers/users.ts` — same

### Step 3 — Update test apps to mount global onError

Handler tests create a minimal Hono app. The test app must now include the global `onError` handler so DomainError → 422 routing works.

- [ ] Update each test file's test app setup to register `app.onError` (import from `app.ts` or inline the same logic)
- [ ] Verify all new DomainError tests PASS (422 with code)
- [ ] Verify all existing tests still PASS

### Step 4 — Verify

- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/api`
- [ ] `node node_modules/.bin/turbo run typecheck`

## Files modified

- `apps/api/src/handlers/customers.ts`
- `apps/api/src/handlers/moves.ts`
- `apps/api/src/handlers/quotes.ts`
- `apps/api/src/handlers/billing.ts`
- `apps/api/src/handlers/inventory.ts`
- `apps/api/src/handlers/orders.ts`
- `apps/api/src/handlers/events.ts`
- `apps/api/src/handlers/api-clients.ts`
- `apps/api/src/handlers/settings.ts`
- `apps/api/src/handlers/users.ts`
- `apps/api/src/handlers/customers.test.ts`
- `apps/api/src/handlers/moves.test.ts`
- `apps/api/src/handlers/quotes.test.ts`
- `apps/api/src/handlers/billing.test.ts`
- `apps/api/src/handlers/inventory.test.ts`
- `apps/api/src/handlers/orders.test.ts`

## Risks

- **Handlers that catch specific non-DomainError exceptions** (e.g., Prisma unique constraint violations) need those handled explicitly. Audit each handler for intentional catches before removing. If any handler catches a specific error class and maps it to a specific HTTP status (e.g., P2025 → 404), preserve that logic.
- **Test apps must register onError** or the DomainError tests won't prove the right thing.
