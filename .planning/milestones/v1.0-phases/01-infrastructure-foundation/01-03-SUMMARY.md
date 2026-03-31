---
phase: 01-infrastructure-foundation
plan: "03"
subsystem: infra
tags: [react-native, expo, cognito, polyfill, crypto, amazon-cognito-identity-js]

# Dependency graph
requires: []
provides:
  - react-native-get-random-values polyfill loaded as absolute first import in _layout.tsx
  - amazon-cognito-identity-js installed and available for Cognito SRP auth
affects:
  - 02-auth-service (uses amazon-cognito-identity-js for SRP authentication)
  - any module that calls crypto.getRandomValues() in the React Native bundle

# Tech tracking
tech-stack:
  added:
    - react-native-get-random-values ~1.11.0 (Expo SDK 54 compatible)
    - amazon-cognito-identity-js ^6.3.16
  patterns:
    - Side-effect import as first statement in expo-router layout root to guarantee polyfill execution order

key-files:
  created: []
  modified:
    - apps/mobile/app/_layout.tsx
    - apps/mobile/package.json
    - package-lock.json

key-decisions:
  - 'Used npx expo install (not npm install) to get SDK 54-compatible version of react-native-get-random-values (~1.11.0)'
  - 'Polyfill placed in _layout.tsx (not index.ts) because expo-router entry bypasses index.ts entirely'

patterns-established:
  - 'Crypto polyfill pattern: import side-effect-only polyfill as line 1 of _layout.tsx before all other imports'

requirements-completed: [INFRA-01]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 01 Plan 03: Polyfill Installation Summary

**`react-native-get-random-values` installed and prepended as the absolute first import in `_layout.tsx`, unblocking `amazon-cognito-identity-js` SRP authentication in the Expo mobile app**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-27T18:04:20Z
- **Completed:** 2026-03-27T18:04:40Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Installed `react-native-get-random-values` (~1.11.0, SDK 54 pinned version) and `amazon-cognito-identity-js` (^6.3.16) via `npx expo install`
- Prepended `import 'react-native-get-random-values'` as line 1 of `apps/mobile/app/_layout.tsx` — before any other import
- Ensured `"main": "expo-router/entry"` is unchanged so the polyfill loads via the correct metro bundle entry path

## Task Commits

Each task was committed atomically:

1. **Task 1: Install packages and prepend polyfill import to _layout.tsx** - `7a598a1` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `apps/mobile/app/_layout.tsx` — polyfill import prepended as absolute line 1
- `apps/mobile/package.json` — two new dependencies added (react-native-get-random-values, amazon-cognito-identity-js)
- `package-lock.json` — lockfile updated with 12 new packages from the install

## Decisions Made

- Used `npx expo install` (not raw `npm install`) to get Expo SDK 54-pinned version of `react-native-get-random-values` (`~1.11.0`) — ensures Metro bundler compatibility.
- Polyfill placed in `_layout.tsx` (not `index.ts`) because `"main": "expo-router/entry"` causes Metro to bypass `index.ts` entirely; `_layout.tsx` is the actual first file in the bundle graph.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `amazon-cognito-identity-js` is installed and crypto polyfill is guaranteed to run before it — unblocks all Cognito SRP auth implementation in Phase 2.
- The mobile auth service (Phase 2) can now import and use `amazon-cognito-identity-js` without runtime errors.

## Known Stubs

None — no UI stubs or placeholder data introduced by this plan.

---

## Self-Check: PASSED

- FOUND: apps/mobile/app/_layout.tsx (line 1 = `import 'react-native-get-random-values'`)
- FOUND: apps/mobile/package.json (both packages in dependencies)
- FOUND: .planning/phases/01-infrastructure-foundation/01-03-SUMMARY.md
- FOUND: commit 7a598a1

_Phase: 01-infrastructure-foundation_
_Completed: 2026-03-27_
