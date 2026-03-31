---
phase: 7
slug: fix-session-expiry-and-stale-tests
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-31
audited: 2026-03-31
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| **Framework**          | Vitest (packages/api) + Jest (apps/mobile)                               |
| **Config file**        | `packages/api/vitest.config.ts` / `apps/mobile/jest.config.js`           |
| **Quick run (mobile)** | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern="authService\|AuthContext"` |
| **Quick run (api)**    | `cd packages/api && node ../../node_modules/.bin/vitest run src/handlers/auth.test.ts` |
| **Full suite command** | `node node_modules/.bin/turbo run test`                                   |
| **Estimated runtime**  | ~15 seconds (quick) / ~60 seconds (full)                                  |

---

## Sampling Rate

- **After every task commit:** Run the quick mobile or api command (whichever matches the changed file)
- **After every plan wave:** Run `node node_modules/.bin/turbo run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status     |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | ---------- |
| 07-01-01  | 01   | 1    | SESSION-04  | unit      | `cd packages/api && node ../../node_modules/.bin/vitest run src/handlers/auth.test.ts` | ✅ | ✅ green |
| 07-01-02  | 01   | 1    | SESSION-04  | unit      | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern=AuthContext` | ✅ | ✅ green |
| 07-01-03  | 01   | 1    | AUTH-03     | unit      | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern=authService` | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. All test files exist; changes are modifications to existing test code only.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |
| App resume after 8+ hour backgrounding does not force logout | SESSION-04 | Requires real device with real JWT (exp in past after 8h) | Install dev build, login, background for >1 min, foreground — should NOT be logged out. Background for session lifetime (or mock time) — should be logged out. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all test files existed)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (131 mobile tests in ~2.35s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-31

---

## Validation Audit 2026-03-31

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 3     |
| Escalated  | 0     |

SESSION-04: `AuthContext.test.tsx` "AppState expiry detection" describe — 3 tests with seconds-scale fixtures (Math.floor(Date.now() / 1000) ± offset). AuthContext.tsx:57 `session.expiresAt * 1000 < Date.now()` confirmed correct.
AUTH-03: `authService.test.ts` "passes idToken from signIn to validate-token body" — asserts `body.idToken` (commit 92cc2f4).
131/131 mobile tests green · 32/32 API tests green.
