# Fix Mobile Test Failures — react-native Module Resolution

**Branch:** `fix/prisma7-typecheck` (same branch, additional commit)

## Problem

All 10 test files in `apps/mobile` that use `@testing-library/react-native` fail with:

```
Cannot find module 'react-native' from '../../node_modules/@testing-library/react-native/build/helpers/accessibility.js'
```

4 test files that don't import `@testing-library/react-native` pass fine (38 tests).

## Root Cause

npm workspace hoisting mismatch:

- `react-native@0.83.4` is installed **only** in `apps/mobile/node_modules/` (not hoisted — likely due to native binary incompatibilities or version conflicts with root)
- `@testing-library/react-native@13.3.3` is hoisted to **root** `node_modules/` (no local copy in `apps/mobile/node_modules/`)

When Jest runs a test that imports `@testing-library/react-native`, it resolves to `<root>/node_modules/@testing-library/react-native/`. That package then does `require('react-native')`, which Node resolves upward from root — but `react-native` isn't there.

The jest.config.js already has `moduleNameMapper` entries for `react`, `react-test-renderer` to force local resolution. The same pattern is needed for `react-native`.

### Additional hoisting concern

`react-native-safe-area-context` and `react-native-web` are also ROOT ONLY (hoisted but may need the local react-native). These are mocked in `jest.setup.js` so they don't cause failures currently, but the resolution is fragile.

## Fix

### Option A: Add `react-native` to moduleNameMapper (minimal, targeted)

In `apps/mobile/jest.config.js`, add a mapper for `react-native`:

```js
moduleNameMapper: {
  // ... existing mappers ...
  '^react-native$': '<rootDir>/node_modules/react-native',
  '^react-native/(.*)$': '<rootDir>/node_modules/react-native/$1',
}
```

This forces all `react-native` imports (including transitive ones from `@testing-library/react-native`) to resolve to the local copy.

**Pros:** One-line fix, follows existing pattern (same thing is done for `react`).
**Cons:** Doesn't fix the underlying hoisting issue; may need more mappers if other RN ecosystem packages get hoisted.

### Option B: Use Jest `roots` + `modulePaths` (broader fix)

```js
modulePaths: ['<rootDir>/node_modules'],
```

This tells Jest to look in the local `node_modules` first for all requires, which matches the behavior you'd expect from running inside `apps/mobile/`.

**Pros:** Fixes react-native and any future hoisting issues in one config.
**Cons:** Could mask real missing-dependency bugs; changes resolution order for all modules.

### Option C: Pin `@testing-library/react-native` as a local dependency

Add `@testing-library/react-native` to a `.npmrc` or use `overrides` to prevent hoisting, ensuring it installs in `apps/mobile/node_modules/` next to `react-native`.

**Pros:** Fixes the root cause at the npm level.
**Cons:** Requires `npm install` changes, may have ripple effects on other workspace packages.

## Recommended: Option A

It follows the existing pattern in the codebase (the `react` and `react-test-renderer` mappers already do exactly this), is minimal, and directly targets the problem.

## Files Changed

- `apps/mobile/jest.config.js` — add `react-native` moduleNameMapper entries

## Verification

```bash
npm run test --workspace=apps/mobile
# Expected: 14 test suites pass, 38+ tests pass
```

Then the full monorepo pre-push hook should pass:

```bash
node node_modules/.bin/turbo run typecheck test
```
