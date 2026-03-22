# Vitest Coverage Configuration

**Branch:** `feature/on-prem-server`
**Goal:** Add coverage reporting to all 5 Vitest configs so coverage gaps are visible and measurable.

## Context

`@vitest/coverage-v8` is installed in web and admin but unconfigured. Domain, api, and infra lack the package entirely. No thresholds are enforced.

## Implementation Checklist

### 1. Install `@vitest/coverage-v8` where missing

- [x] `npm install -D @vitest/coverage-v8` in `packages/domain`, `packages/api`, `packages/infra`

### 2. Add coverage config to each vitest.config.ts

- [x] `packages/domain/vitest.config.ts` — add `coverage: { provider: 'v8', reporter: ['text', 'lcov'], reportsDirectory: './coverage' }`
- [x] `packages/api/vitest.config.ts` — same
- [x] `packages/web/vitest.config.ts` — same
- [x] `apps/admin/vitest.config.ts` — same
- [x] `packages/infra/vitest.config.ts` — same

### 3. Add `.gitignore` entries

- [x] Add `coverage/` to root `.gitignore` if not already present (was already present)

### 4. Verify

- [x] `npm test` passes (pre-existing failures in prisma-tenant-isolation and openapi handler tests are unrelated to this task; confirmed present before changes)
- [x] `npm run typecheck` — no new type errors introduced (pre-existing admin typecheck errors confirmed before changes)

## Files

| Action | Path |
|--------|------|
| Modify | `packages/domain/vitest.config.ts` |
| Modify | `packages/api/vitest.config.ts` |
| Modify | `packages/web/vitest.config.ts` |
| Modify | `apps/admin/vitest.config.ts` |
| Modify | `packages/infra/vitest.config.ts` |
| Modify | `packages/domain/package.json` (added `@vitest/coverage-v8`) |
| Modify | `packages/api/package.json` (added `@vitest/coverage-v8`) |
| Modify | `packages/infra/package.json` (added `@vitest/coverage-v8`) |
| No-op  | `.gitignore` (coverage/ already present) |

## Initial Thresholds (informational, not blocking)

- domain: 80% statements, 80% branches
- api: 60% statements
- web/admin: 40% statements

## Risks / Side Effects

- `@vitest/coverage-v8` install modifies `package.json` and `package-lock.json` in 3 packages
- lcov files can be large; ensure `coverage/` is gitignored

## Notes

- Root `package.json` contains a broken `link:@th0rgal/ralph-wiggum` dependency (added on this branch) that prevents workspace-level `npm install`. Worked around by running `npm install --no-workspaces` in each package directory.
- domain: installed standalone (created `packages/domain/package-lock.json` and `packages/domain/node_modules/`)
- api: package.json manually edited (cannot run standalone install due to `@pegasus/domain` workspace dep); package is hoisted to root `node_modules`
- infra: installed standalone (created `packages/infra/package-lock.json`)

## Dependencies

None — can start immediately.
