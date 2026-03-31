---
phase: 4
slug: tenant-resolution-flow
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
audited: 2026-03-31
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- | ----- | --------- |
| **Framework**          | Jest 29.7 + @testing-library/react-native 13.3                                            |
| **Config file**        | `apps/mobile/jest.config.js`                                                              |
| **Quick run command**  | `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit --testPathPattern="(auth | login | tenant)"` |
| **Full suite command** | `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit`                         |
| **Estimated runtime**  | ~15 seconds                                                                               |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit --testPathPattern="(auth|login|tenant)"`
- **After every plan wave:** Run `cd apps/mobile && node ../../node_modules/.bin/jest --forceExit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type        | Automated Command                             | File Exists      | Status     |
| ------- | ---- | ---- | ----------- | ---------------- | --------------------------------------------- | ---------------- | ---------- |
| 4-01-W0 | 01   | 0    | TENANT-03   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ✅ `app/(auth)/tenant-picker.test.tsx` | ✅ green |
| 4-01-W0 | 01   | 0    | TENANT-06   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ✅ `app/(auth)/tenant-picker.test.tsx` | ✅ green |
| 4-02-W0 | 02   | 0    | TENANT-01   | unit             | `jest --testPathPattern="authService"`        | ✅ `src/auth/authService.test.ts` | ✅ green |
| 4-02-W0 | 02   | 0    | TENANT-02   | unit             | `jest --testPathPattern="authService"`        | ✅ `src/auth/authService.test.ts` | ✅ green |
| 4-01-01 | 01   | 1    | TENANT-03   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ✅ | ✅ green |
| 4-01-02 | 01   | 1    | TENANT-06   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ✅ | ✅ green |
| 4-02-01 | 02   | 1    | TENANT-01   | unit             | `jest --testPathPattern="authService"`        | ✅ | ✅ green |
| 4-02-02 | 02   | 1    | TENANT-01   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ `app/(auth)/login.test.tsx` | ✅ green |
| 4-02-03 | 02   | 1    | TENANT-02   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ | ✅ green |
| 4-02-04 | 02   | 1    | TENANT-04   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ | ✅ green |
| 4-02-05 | 02   | 1    | TENANT-05   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [x] `apps/mobile/app/(auth)/tenant-picker.test.tsx` — 6 tests covering TENANT-03 (selectTenant call, router.replace), TENANT-06 (layout Stack registration), error handling
- [x] `apps/mobile/src/auth/authService.test.ts` — `resolveTenants` describe (3 tests: success, empty, non-2xx) and `selectTenant` describe (3 tests: success, 403, 404)
- [x] `apps/mobile/app/(auth)/login.test.tsx` — 13 tests covering TENANT-01 through TENANT-05 in two-step LoginScreen describe blocks

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |

_All phase behaviors have automated verification._

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all test files exist)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (131 mobile tests in ~2.35s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-31

---

## Validation Audit 2026-03-31

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 11    |
| Escalated  | 0     |

All 6 requirements (TENANT-01 through TENANT-06) have automated verification.
TENANT-01/02: `authService.test.ts` resolveTenants + selectTenant describes (6 tests).
TENANT-01 through TENANT-05: `login.test.tsx` (13 tests, email and password step).
TENANT-03/TENANT-06: `tenant-picker.test.tsx` (6 tests).
131/131 mobile tests green.
