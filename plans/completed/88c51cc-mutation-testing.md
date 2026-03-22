# Mutation Testing for Domain Package

**Branch:** `feature/on-prem-server`
**Goal:** Stryker mutation testing for the domain package targeting 80%+ mutation score to verify test quality.

## Context

Passing tests don't guarantee strong tests. Mutation testing measures whether tests detect changes in business logic. Typical first-run scores are 50-70%.

## Implementation Checklist

### 1. Install Stryker

- [x] `npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner` in `packages/domain`

### 2. Stryker configuration

- [x] Create `packages/domain/stryker.config.mjs`
  - Vitest runner
  - Target `src/` directory
  - Exclude test files from mutation
  - HTML + clear-text reporters

### 3. Add npm script

- [x] Add `"mutation-test"` script to `packages/domain/package.json`

### 4. Add reports/ to .gitignore

- [x] Created `packages/domain/.gitignore` excluding `reports/`

### 5. Verify

- [x] Config created — stryker run NOT executed (slow, run on schedule)
- [x] `npm test` — all 219 tests pass
- [x] `npm run typecheck` — no type errors

## Files

| Action | Path |
|--------|------|
| Create | `packages/domain/stryker.config.mjs` |
| Create | `packages/domain/.gitignore` |
| Modify | `packages/domain/package.json` |

## Risks / Side Effects

- Stryker install adds several devDependencies
- Mutation testing is slow (minutes, not seconds) — run on schedule, not per-PR
- May reveal weak assertions that need fixing in existing tests

## Dependencies

- **Task 2 (vitest-coverage-config)** — coverage config should exist first
- **Task 5 (domain-test-expansion)** — need good baseline test coverage for meaningful mutation scores
