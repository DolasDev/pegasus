---
phase: 5
slug: login-ux-and-auth-guard
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-28
audited: 2026-03-28
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Framework**          | vitest (packages/api) + jest (apps/mobile, via expo)                         |
| **Config file**        | apps/mobile/jest.config.js                                                   |
| **Quick run command**  | `cd apps/mobile && npx jest --testPathPattern="login\|layout" --no-coverage` |
| **Full suite command** | `node node_modules/.bin/turbo run test`                                      |
| **Estimated runtime**  | ~15 seconds (quick), ~60 seconds (full)                                      |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && npx jest --testPathPattern="login\|layout" --no-coverage`
- **After every plan wave:** Run `node node_modules/.bin/turbo run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                                     | File Exists | Status     |
| -------- | ---- | ---- | ----------- | --------- | --------------------------------------------------------------------- | ----------- | ---------- |
| 05-01-01 | 01   | 1    | AUTH-04     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ✅ `app/(auth)/login.test.tsx`  | ✅ green |
| 05-01-02 | 01   | 1    | AUTH-05     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ✅ `app/(auth)/login.test.tsx`  | ✅ green |
| 05-01-03 | 01   | 1    | AUTH-06     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ✅ `app/(auth)/login.test.tsx`  | ✅ green |
| 05-02-01 | 02   | 2    | GUARD-01    | unit      | `cd apps/mobile && npx jest --testPathPattern="layout" --no-coverage` | ✅ `app/_layout.test.tsx`       | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [x] `apps/mobile/app/(auth)/login.test.tsx` — AUTH-04, AUTH-05, AUTH-06 (password toggle, inline errors, input locking) — 22 tests, all green
- [x] `apps/mobile/app/_layout.test.tsx` — GUARD-01 (Stack.Protected auth guard, SplashScreen) — 5 tests, all green
- [x] `jest.setup.js` — expo-router mock includes `Stack.Protected`, `SplashScreen.preventAutoHideAsync`/`hideAsync`
- [x] AuthContext mock reflects `login()` → `Promise<void>` (throws `AuthError`) interface

---

## Manual-Only Verifications

| Behavior                                                    | Requirement | Why Manual                                                                   | Test Instructions                                                                                              |
| ----------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No login-screen flash on cold launch (authenticated driver) | GUARD-01    | Requires real device/simulator — SplashScreen timing is not testable in jest | Start app on device while authenticated, observe that home screen renders without login screen appearing first |
| Password toggle visual reveal/conceal on device             | AUTH-04     | Font rendering and secureTextEntry visual output cannot be asserted in jest  | Tap SHOW on device, verify password characters are visible; tap HIDE, verify dots return                       |

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all complete)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (1.46s observed)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-28

---

## Validation Audit 2026-03-28

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 4     |
| Escalated  | 0     |

All 4 requirements (AUTH-04, AUTH-05, AUTH-06, GUARD-01) had complete test coverage at audit time.
Tests co-located with source in `apps/mobile/app/` rather than `apps/mobile/__tests__/` (plan noted `__tests__/` path, implementation chose co-location).
27 tests total, 100% green.
