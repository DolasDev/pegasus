# Fix mobile app test failures

## Goal

Get all 14 test suites in `apps/mobile` passing. Currently every suite fails before any test runs.

## Root Cause

`jest.config.js` has `moduleNameMapper` entries that pin `react` to `<rootDir>/node_modules/react`. npm workspaces hoist react to the root `node_modules/` — there is no local copy at `apps/mobile/node_modules/react`. Jest cannot resolve the module and every suite crashes at `jest.setup.js:8`.

The `modulePaths: ['<rootDir>/node_modules']` setting has the same problem — the directory barely exists locally.

## Fix — Code Changes Only

### 1. `apps/mobile/jest.config.js`

- Remove the `'^react$'` and `'^react/(.*)$'` entries from `moduleNameMapper`. React is a singleton in this workspace (19.2.4 everywhere) so there's no multi-instance risk to guard against.
- Remove `modulePaths` — it points to a mostly-empty local `node_modules`. The root resolver already finds hoisted packages.
- Keep `'^@/(.*)$'` and `'^@pegasus/theme$'` mappers (they're correct).

```js
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@pegasus/theme$': '<rootDir>/../../packages/theme/src/index.ts',
},
```

### 2. `apps/mobile/jest.setup.js`

- The react-native 0.81.6 renderer checks for react 19.1.4, but the installed version is 19.2.4. The version spoof on line 9 sets it to `'19.1.4'` — verify this still works after the resolver fix. If react-native has updated its expected version, update the spoof string to match. (Likely fine as-is since the spoof predates the resolution bug.)

### 3. `apps/mobile/jest.config.js` — preset conflict

- The config sets `testEnvironment: 'node'` but the `react-native` preset provides its own test environment (`react-native-env.js`). For component snapshot tests this may cause failures even after the resolution fix. Change to:

```js
testEnvironment: require.resolve('react-native/jest/react-native-env.js'),
```

Or simply remove the `testEnvironment` line to let the preset default take over.

## Files to Change

| File                         | Change                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `apps/mobile/jest.config.js` | Remove react `moduleNameMapper` entries, remove `modulePaths`, fix `testEnvironment` |
| `apps/mobile/jest.setup.js`  | Verify/update version spoof string if needed after fix                               |

## Verification

1. `cd apps/mobile && npx jest --forceExit` — all 14 suites pass (8 test files)
2. `node node_modules/.bin/turbo run test` — no regressions in other packages
