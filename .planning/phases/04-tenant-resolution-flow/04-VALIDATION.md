---
phase: 4
slug: tenant-resolution-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
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
| 4-01-W0 | 01   | 0    | TENANT-03   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ❌ W0 gap        | ⬜ pending |
| 4-01-W0 | 01   | 0    | TENANT-06   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ❌ W0 gap        | ⬜ pending |
| 4-02-W0 | 02   | 0    | TENANT-01   | unit             | `jest --testPathPattern="authService"`        | ✅ extend needed | ⬜ pending |
| 4-02-W0 | 02   | 0    | TENANT-02   | unit             | `jest --testPathPattern="authService"`        | ✅ extend needed | ⬜ pending |
| 4-01-01 | 01   | 1    | TENANT-03   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ❌ W0            | ⬜ pending |
| 4-01-02 | 01   | 1    | TENANT-06   | unit (component) | `jest --testPathPattern="tenant-picker.test"` | ❌ W0            | ⬜ pending |
| 4-02-01 | 02   | 1    | TENANT-01   | unit             | `jest --testPathPattern="authService"`        | ✅ extend needed | ⬜ pending |
| 4-02-02 | 02   | 1    | TENANT-01   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ extend needed | ⬜ pending |
| 4-02-03 | 02   | 1    | TENANT-02   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ extend needed | ⬜ pending |
| 4-02-04 | 02   | 1    | TENANT-04   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ extend needed | ⬜ pending |
| 4-02-05 | 02   | 1    | TENANT-05   | unit (component) | `jest --testPathPattern="login.test"`         | ✅ extend needed | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `apps/mobile/app/(auth)/tenant-picker.test.tsx` — stubs for TENANT-03, TENANT-06 (new file)
- [ ] `apps/mobile/src/auth/authService.test.ts` — extend with `resolveTenants` and `selectTenant` describe blocks (TENANT-01, TENANT-02)
- [ ] `apps/mobile/app/(auth)/login.test.tsx` — extend with two-step state machine tests (TENANT-01 through TENANT-05)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |

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
