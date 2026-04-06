# Fix Mobile App (@pegasus/mobile) Test Suite

## Problem

All 14 test suites in `apps/mobile/` fail with the same error:

```
Could not locate module react mapped as:
/home/steve/repos/pegasus/apps/mobile/node_modules/react
```

Every test crashes in `jest.setup.js:8` at `const React = require('react')` before any
test code runs — so **zero tests execute**.

## Root Cause

The jest config (`apps/mobile/jest.config.js`) uses `moduleNameMapper` to pin React to a
local copy:

```js
'^react$': '<rootDir>/node_modules/react',
```

But `apps/mobile/node_modules/react` doesn't exist. The root `package.json` has an npm
override `"react": "19.2.4"` which forces all react resolutions to 19.2.4 and hoists the
single copy to the **root** `node_modules/`. Since mobile declares `"react": "19.2.4"` as
a direct dep (same version as the override), npm deduplicates it to root — no local copy
is created.

The jest config also pins `react-test-renderer` to `<rootDir>/node_modules/react-test-renderer`
which is similarly hoisted and missing locally.

Additional context: `jest.setup.js` spoofs `React.version` to `"19.1.4"` to satisfy
react-native 0.81.6's strict version check, but with react 19.2.4 the version gap is
larger — this hack may need revisiting.

## Fix Plan

### Task 1: Fix moduleNameMapper resolution

**File:** `apps/mobile/jest.config.js`

Update `moduleNameMapper` to resolve react from root instead of local `node_modules`:

```js
// Option A: Remove the mapper and let normal resolution find hoisted react
// (remove the '^react$' and '^react-test-renderer$' entries)

// Option B: Point to root node_modules explicitly
'^react$': '<rootDir>/../../node_modules/react',
'^react/(.*)$': '<rootDir>/../../node_modules/react/$1',
'^react-test-renderer$': '<rootDir>/../../node_modules/react-test-renderer',
'^react-test-renderer/(.*)$': '<rootDir>/../../node_modules/react-test-renderer/$1',
```

Option A is preferred — the `modulePaths: ['<rootDir>/node_modules']` setting was added for
the same reason but doesn't help when `moduleNameMapper` takes precedence. Removing the
explicit mapper entries lets Jest use its default resolution (which finds hoisted packages).

If that causes the dual-React-instance problem the comments warn about, fall back to Option B.

### Task 2: Revisit the React version spoof in jest.setup.js

**File:** `apps/mobile/jest.setup.js`

The version spoof `value: '19.1.4'` was written for when the workspace had react 19.1.5
but react-native expected 19.1.4. Now with react 19.2.4, the spoof value may need updating
depending on what react-native 0.81.6 actually checks. Verify:

1. Check what version string react-native's renderer expects:
   `grep -r "19.1.4\|reactVersion\|version.*check" node_modules/react-native/Libraries/Renderer/`
2. If it checks for `19.2.4`, update the spoof or remove it entirely.
3. If it checks for a different version, update to match.

### Task 3: Verify the react-native / react version compatibility

React 19.2.4 + react-native 0.81.6 may have a genuine version mismatch. Check
react-native 0.81.6's `peerDependencies` for what react version it supports:

```
npm view react-native@0.81.6 peerDependencies
```

If react 19.2.4 is out of range, either:

- Pin mobile's react to the supported version (may conflict with root override)
- Upgrade react-native to a version that supports react 19.2.4

### Task 4: Run tests and verify

After fixes:

```
npx turbo run test --filter=@pegasus/mobile
```

All 14 test suites should execute. Fix any secondary failures that emerge once the
module resolution error is cleared.

## Files to Modify

- `apps/mobile/jest.config.js` — moduleNameMapper paths
- `apps/mobile/jest.setup.js` — React version spoof (if needed)
- `apps/mobile/package.json` — react/react-native versions (if compatibility issue)

## Risk

Low — mobile tests are already 100% broken. Any change improves the situation. The
existing web/API test suites are unaffected (they use vitest, not jest).
