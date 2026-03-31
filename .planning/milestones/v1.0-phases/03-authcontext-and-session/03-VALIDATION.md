---
phase: 3
slug: authcontext-and-session
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
audited: 2026-03-31
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| **Framework**          | Jest 29.7.0 + @testing-library/react-native 13.3.3                      |
| **Config file**        | `apps/mobile/jest.config.js`                                             |
| **Quick run command**  | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` |
| **Full suite command** | `cd apps/mobile && npm test`                                             |
| **Estimated runtime**  | ~15 seconds (quick), ~60 seconds (full)                                  |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit`
- **After every plan wave:** Run `cd apps/mobile && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status     |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | ---------- |
| 03-01-01  | 01   | 0    | SESSION-01  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ✅ | ✅ green |
| 03-01-02  | 01   | 1    | SESSION-01  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ✅ | ✅ green |
| 03-01-03  | 01   | 1    | SESSION-03  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ✅ | ✅ green |
| 03-02-01  | 02   | 2    | SESSION-02  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ✅ | ✅ green |
| 03-02-02  | 02   | 2    | SESSION-04  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [x] `apps/mobile/jest.setup.js` — `expo-secure-store` mock (getItemAsync, setItemAsync, deleteItemAsync)
- [x] `apps/mobile/jest.config.js` — `expo-secure-store` in `transformIgnorePatterns`
- [x] `apps/mobile/package.json` — `expo-secure-store ~15.0.8` installed
- [x] `apps/mobile/src/context/AuthContext.test.tsx` — 11 tests covering SESSION-01 through SESSION-04 with mock authService, AppState spy, and SecureStore mock

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |
| Cold-start session restore renders authenticated route without flash | SESSION-02 | Requires device/emulator for real navigation timing | Run app with valid stored session; confirm no login flash before route renders |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all test files exist)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (11 AuthContext tests in ~2s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-31

---

## Validation Audit 2026-03-31

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 5     |
| Escalated  | 0     |

All 4 requirements (SESSION-01, SESSION-02, SESSION-03, SESSION-04) have automated verification.
SESSION-01: `AuthContext.test.tsx` "login — SESSION-01" describe — 3 tests covering persist, no-raw-token, failure.
SESSION-02: `AuthContext.test.tsx` "checkSession — SESSION-02" describe — 2 tests covering restore and no-session.
SESSION-03: `AuthContext.test.tsx` "logout — SESSION-03" describe — 1 test.
SESSION-04: `AuthContext.test.tsx` "AppState expiry detection — SESSION-04" describe — 3 tests (expired/valid/background). Note: expiresAt fixtures use seconds-scale values (Math.floor(Date.now() / 1000)) after Phase 07 fix.
131/131 mobile tests green.
Manual-only: cold-start session restore visual (device/emulator required).
