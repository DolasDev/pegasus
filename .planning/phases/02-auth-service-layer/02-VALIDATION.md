---
phase: 2
slug: auth-service-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                        |
| ---------------------- | ------------------------------------------------------------ |
| **Framework**          | Jest 29 with `react-native` preset                           |
| **Config file**        | `apps/mobile/jest.config.js`                                 |
| **Quick run command**  | `cd apps/mobile && npm test -- --testPathPattern=src/auth --forceExit` |
| **Full suite command** | `cd apps/mobile && npm test`                                 |
| **Estimated runtime**  | ~15 seconds (quick) / ~45 seconds (full)                     |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && npm test -- --testPathPattern=src/auth --forceExit`
- **After every plan wave:** Run `cd apps/mobile && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status     |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | ---------- |
| 2-01-01   | 01   | 1    | AUTH-02     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/cognitoService --forceExit` | ❌ W0 | ⬜ pending |
| 2-01-02   | 01   | 1    | AUTH-02     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/cognitoService --forceExit` | ❌ W0 | ⬜ pending |
| 2-02-01   | 02   | 2    | AUTH-01     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/authService --forceExit` | ❌ W0 | ⬜ pending |
| 2-02-02   | 02   | 2    | AUTH-03     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/authService --forceExit` | ❌ W0 | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `apps/mobile/src/auth/types.ts` — `Session`, `AuthError`, `MobileConfig` types
- [ ] `apps/mobile/src/auth/cognitoService.ts` — `signIn` implementation skeleton
- [ ] `apps/mobile/src/auth/authService.ts` — `createAuthService` factory skeleton
- [ ] `apps/mobile/src/auth/cognitoService.test.ts` — test stubs covering AUTH-02
- [ ] `apps/mobile/src/auth/authService.test.ts` — test stubs covering AUTH-01, AUTH-03

_Existing infrastructure covers framework setup — `jest.config.js` and `jest.setup.js` already exist._

---

## Manual-Only Verifications

_All phase behaviors have automated verification._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
