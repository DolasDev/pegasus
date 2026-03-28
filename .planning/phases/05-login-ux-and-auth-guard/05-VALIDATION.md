---
phase: 5
slug: login-ux-and-auth-guard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
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
| 05-01-01 | 01   | 1    | AUTH-04     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ❌ W0       | ⬜ pending |
| 05-01-02 | 01   | 1    | AUTH-05     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ❌ W0       | ⬜ pending |
| 05-01-03 | 01   | 1    | AUTH-06     | unit      | `cd apps/mobile && npx jest --testPathPattern="login" --no-coverage`  | ❌ W0       | ⬜ pending |
| 05-02-01 | 02   | 2    | GUARD-01    | unit      | `cd apps/mobile && npx jest --testPathPattern="layout" --no-coverage` | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `apps/mobile/__tests__/login.test.tsx` — stubs for AUTH-04, AUTH-05, AUTH-06 (password toggle, inline errors, input locking)
- [ ] `apps/mobile/__tests__/layout.test.tsx` — stubs for GUARD-01 (Stack.Protected auth guard, no flash)
- [ ] `jest.setup.js` — extend expo-router mock with `Stack.Protected` and `SplashScreen.preventAutoHideAsync`/`hideAsync` stubs (CRITICAL: current mock only has `Stack.Screen`)
- [ ] Update AuthContext mock to reflect `login()` → `Promise<void>` (throws `AuthError`) interface change

---

## Manual-Only Verifications

| Behavior                                                    | Requirement | Why Manual                                                                   | Test Instructions                                                                                              |
| ----------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No login-screen flash on cold launch (authenticated driver) | GUARD-01    | Requires real device/simulator — SplashScreen timing is not testable in jest | Start app on device while authenticated, observe that home screen renders without login screen appearing first |
| Password toggle visual reveal/conceal on device             | AUTH-04     | Font rendering and secureTextEntry visual output cannot be asserted in jest  | Tap SHOW on device, verify password characters are visible; tap HIDE, verify dots return                       |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
