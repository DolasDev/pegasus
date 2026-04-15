# Plan: Bump apps/mobile Expo SDK to latest 55.0.x patch

**Branch:** TBD (create from main)
**Goal:** Unblock the `Test` CI job by aligning `apps/mobile` dependencies with the versions `npx expo install --check` currently expects.

## Problem

The `Test` CI job runs `npx expo install --check` as a pre-flight step. It now fails with:

```
The following packages should be updated for best compatibility with the installed expo version:
  expo@55.0.14           - expected version: ~55.0.15
  expo-constants@55.0.13 - expected version: ~55.0.14
  expo-linking@55.0.12   - expected version: ~55.0.13
```

`apps/mobile/package.json` pins `"expo": "~55.0.14"`. The Expo CLI's expected-version table was updated upstream after our last successful main build (2026-04-11), so `--check` now reports drift on every PR.

This is not caused by any recent Pegasus code change — it's external drift from the Expo 55 patch train.

## Checklist

- [ ] In `apps/mobile/package.json`, bump:
  - `expo` → `~55.0.15`
  - `expo-constants` → `~55.0.14`
  - `expo-linking` → `~55.0.13`
  - Anything else `npx expo install --check` reports after the bump.
- [ ] Run `npx expo install --check` from `apps/mobile/` — must report clean.
- [ ] Run `npx expo-doctor` — tolerate only the known duplicate-dependency warning (react@19.2.0 vs 19.2.4) that the CI script already filters.
- [ ] Run full repo tests: `node node_modules/.bin/turbo run test` — mobile test suite (including `__tests__/expo-compat.test.ts`) must pass.
- [ ] Smoke test the mobile app boots in the dev client (`cd apps/mobile && npx expo start`) — confirm no runtime regressions from the patch bump.
- [ ] Verify `package-lock.json` diff contains only expo-family packages (no unrelated churn).

## Out of scope

- Major Expo SDK upgrades (56+).
- Replacing the duplicate-dependency tolerance in the CI Expo doctor step.

## Verification

CI `Test` job green on the follow-up PR.
