---
phase: 3
slug: authcontext-and-session
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
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
| 03-01-01  | 01   | 0    | SESSION-01  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | ❌ W0 | ⬜ pending |
| 03-01-02  | 01   | 1    | SESSION-01  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | Rewrite existing | ⬜ pending |
| 03-01-03  | 01   | 1    | SESSION-03  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | Rewrite existing | ⬜ pending |
| 03-02-01  | 02   | 2    | SESSION-02  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | Rewrite existing | ⬜ pending |
| 03-02-02  | 02   | 2    | SESSION-04  | unit      | `cd apps/mobile && npm test -- --testPathPattern=AuthContext --forceExit` | Rewrite existing | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `apps/mobile/jest.setup.js` — add `expo-secure-store` mock
- [ ] `apps/mobile/jest.config.js` — add `expo-secure-store` to `transformIgnorePatterns`
- [ ] `apps/mobile/package.json` — add `expo-secure-store ~15.0.8` (via `npx expo install expo-secure-store`)
- [ ] `apps/mobile/src/context/AuthContext.test.tsx` — full rewrite to cover SESSION-01 through SESSION-04 with mock authService and AppState spy

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |
| Cold-start session restore renders authenticated route without flash | SESSION-02 | Requires device/emulator for real navigation timing | Run app with valid stored session; confirm no login flash before route renders |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
