---
phase: 2
slug: auth-service-layer
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
audited: 2026-03-31
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
| 2-01-01   | 01   | 1    | AUTH-02     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/cognitoService --forceExit` | ✅ | ✅ green |
| 2-01-02   | 01   | 1    | AUTH-02     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/cognitoService --forceExit` | ✅ | ✅ green |
| 2-02-01   | 02   | 2    | AUTH-01     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/authService --forceExit` | ✅ | ✅ green |
| 2-02-02   | 02   | 2    | AUTH-03     | unit      | `cd apps/mobile && npm test -- --testPathPattern=src/auth/authService --forceExit` | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [x] `apps/mobile/src/auth/types.ts` — `Session`, `AuthError`, `MobileConfig` types
- [x] `apps/mobile/src/auth/cognitoService.ts` — `signIn` implementation skeleton
- [x] `apps/mobile/src/auth/authService.ts` — `createAuthService` factory skeleton
- [x] `apps/mobile/src/auth/cognitoService.test.ts` — 4 tests covering AUTH-02 (success, NotAuthorizedException, NewPasswordRequired, UnknownError)
- [x] `apps/mobile/src/auth/authService.test.ts` — 5 tests covering AUTH-01 (fetchMobileConfig) and AUTH-03 (authenticate orchestration)

_Existing infrastructure covers framework setup — `jest.config.js` and `jest.setup.js` already exist._

---

## Manual-Only Verifications

_All phase behaviors have automated verification._

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all test files exist)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (9 tests in ~2s as part of 131-test suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-31

---

## Validation Audit 2026-03-31

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 4     |
| Escalated  | 0     |

All 3 requirements (AUTH-01, AUTH-02, AUTH-03) have automated verification.
AUTH-02: `apps/mobile/src/auth/cognitoService.test.ts` — 4 tests covering SRP success and all failure paths.
AUTH-01: `apps/mobile/src/auth/authService.test.ts` — 2 tests covering fetchMobileConfig success and non-2xx failure.
AUTH-03: `apps/mobile/src/auth/authService.test.ts` — 3 tests covering authenticate orchestration, idToken forwarding, validate-token failure.
131/131 mobile tests green.
