# Plan: Web frontend component tests

**Branch:** main
**Goal:** Add React component tests for `packages/web`, with required vitest config fix.

## Context

`packages/web` has `@testing-library/react` in devDependencies and `environment: 'jsdom'` in
`vitest.config.ts`, but no React JSX transform plugin is configured — making component tests
impossible today. The admin app (`apps/admin`) already has a working setup with
`@vitejs/plugin-react`, `@testing-library/jest-dom`, and a `setup.ts` file to copy from.

There are 4 pure UI components with no external dependencies that are ideal first targets:
`StatusBadge`, `EmptyState`, `PageHeader`, `DataTable`. Route components use TanStack Router
and are out of scope for this plan.

## Checklist

### Infrastructure (must complete before any component tests)

- [ ] Add `@testing-library/jest-dom` to devDependencies in `packages/web/package.json`
  - Check if already present first; if not, add `"@testing-library/jest-dom": "*"`
- [ ] Create `packages/web/src/__tests__/setup.ts`:
  ```ts
  import '@testing-library/jest-dom'
  ```
- [ ] Update `packages/web/vitest.config.ts`:
  - Add `import react from '@vitejs/plugin-react'`
  - Add `plugins: [react()]`
  - Add `setupFiles: ['./src/__tests__/setup.ts']`
  - (`@vitejs/plugin-react` is already in devDependencies — no `npm install` needed)
- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/web` to confirm existing tests still pass

### Component tests

#### `StatusBadge` (`src/components/StatusBadge.tsx`)

- [ ] Create `packages/web/src/__tests__/StatusBadge.test.tsx`
- [ ] Read source first to understand props/variants
- [ ] Tests: renders status text; applies correct variant per status value

#### `EmptyState` (`src/components/EmptyState.tsx`)

- [ ] Create `packages/web/src/__tests__/EmptyState.test.tsx`
- [ ] Read source first
- [ ] Tests: renders title and description; renders optional action slot when provided; does not crash when action is omitted

#### `PageHeader` (`src/components/PageHeader.tsx`)

- [ ] Create `packages/web/src/__tests__/PageHeader.test.tsx`
- [ ] Read source first
- [ ] Tests: renders title; renders optional subtitle; renders action slot

#### `DataTable` (`src/components/DataTable.tsx`)

- [ ] Create `packages/web/src/__tests__/DataTable.test.tsx`
- [ ] Read source first to understand column/row prop shape
- [ ] Tests: renders column headers; renders one row per data item; renders empty state when data array is empty

- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/web`

## Files created/modified

- `packages/web/package.json` — add `@testing-library/jest-dom` devDependency
- `packages/web/vitest.config.ts` — add React plugin and setupFiles
- `packages/web/src/__tests__/setup.ts` (new)
- `packages/web/src/__tests__/StatusBadge.test.tsx` (new)
- `packages/web/src/__tests__/EmptyState.test.tsx` (new)
- `packages/web/src/__tests__/PageHeader.test.tsx` (new)
- `packages/web/src/__tests__/DataTable.test.tsx` (new)

## Files read (reference)

- `apps/admin/vitest.config.ts` — working React vitest config to mirror
- `apps/admin/src/__tests__/setup.ts` — jest-dom import pattern
- `apps/admin/src/__tests__/TenantFormDialog.test.tsx` — component test pattern
- `packages/web/src/components/StatusBadge.tsx` — before writing test
- `packages/web/src/components/EmptyState.tsx` — before writing test
- `packages/web/src/components/PageHeader.tsx` — before writing test
- `packages/web/src/components/DataTable.tsx` — before writing test

## Side effects / risks

- Adding `@testing-library/jest-dom` as a devDependency requires running `npm install` at the
  root before tests can pass. If it is already in the workspace root `node_modules` (likely, as
  admin uses it), adding the dep entry is sufficient — no install needed.
- Route components (`moves.index.tsx`, `customers.index.tsx`, etc.) use `createFileRoute` from
  TanStack Router. These are **out of scope** — they require router context mocking and are
  deferred to a future plan.
- `@vitejs/plugin-react` is already present in `packages/web/package.json` devDependencies.

## Verification

```bash
node node_modules/.bin/turbo run test --filter=@pegasus/web
# Expect: existing tests (utils, pkce, session, cognito, client) pass + new component tests pass
```
