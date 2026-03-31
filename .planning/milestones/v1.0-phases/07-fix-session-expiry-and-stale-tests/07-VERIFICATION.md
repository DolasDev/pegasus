---
phase: 07-fix-session-expiry-and-stale-tests
verified: 2026-03-31T17:00:00Z
status: passed
score: 4/4 must-haves verified
gaps: []
---

# Phase 7: Fix Session Expiry and Stale Tests — Verification Report

**Phase Goal:** Every real driver session survives app backgrounding; the expiresAt cross-phase contract is consistent (seconds throughout the API contract, with conversion at the comparison site); all tests reflect current production code
**Verified:** 2026-03-31T17:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                        | Status     | Evidence                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| 1   | App resume with a real Cognito session (expiresAt in seconds) does NOT immediately force logout              | ✓ VERIFIED | AuthContext.tsx:57 reads `session.expiresAt * 1000 < Date.now()` — seconds value ~1.7e9 × 1000 ≈ 1.7e12, always greater than Date.now() for a future session |
| 2   | App resume with a genuinely expired session (expiresAt 1 second in the past, seconds-scale) does force logout | ✓ VERIFIED | AuthContext.test.tsx:195, 243 use `Math.floor(Date.now() / 1000) - 1` — after × 1000 this resolves to ~1 second in the past; the SESSION-04 test at line 206-212 confirms logout is triggered |
| 3   | The test "passes idToken from signIn to validate-token body" passes                                          | ✓ VERIFIED | authService.test.ts:143-144 asserts `body.idToken === 'raw-id-token'`; no `body.token` references remain in the file |
| 4   | All AuthContext.test.tsx SESSION-04 tests correctly exercise the expiry check against seconds-scale fixtures   | ✓ VERIFIED | All 5 expiresAt fixture lines (25, 152, 195, 221, 243) use `Math.floor(Date.now() / 1000)` ± offset; zero millisecond-scale `Date.now() + 3600_000` or `Date.now() - 1000` patterns remain |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact                                                      | Expected                                                              | Status     | Details                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `apps/mobile/src/context/AuthContext.tsx`                     | Corrected expiresAt comparison (seconds→milliseconds at comparison site) | ✓ VERIFIED | Line 57: `session.expiresAt * 1000 < Date.now()` with inline comment; exists, substantive, wired |
| `apps/mobile/src/context/AuthContext.test.tsx`                | Seconds-scale expiresAt fixtures in all 5 locations                   | ✓ VERIFIED | Lines 25, 152, 195, 221, 243 all use `Math.floor(Date.now() / 1000)` ± offset                   |
| `apps/mobile/src/auth/authService.test.ts`                    | Corrected body field type assertion and expectation                   | ✓ VERIFIED | Lines 143-144: `{ idToken: string }` type assertion; `body.idToken` property access              |

---

### Key Link Verification

| From                                     | To                                             | Via                                                      | Status     | Details                                                                                               |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `AuthContext.tsx:57`                      | `AuthContext.test.tsx SESSION-04 fixtures`      | `session.expiresAt * 1000 < Date.now()`                 | ✓ VERIFIED | Production code multiplies by 1000; test expired fixtures use `Math.floor(Date.now() / 1000) - 1` so `(now/1000 - 1) * 1000` correctly falls in the past |
| `apps/mobile/src/auth/authService.ts:71` | `authService.test.ts:143-144`                  | `JSON.stringify({ idToken })` → `body.idToken`           | ✓ VERIFIED | Production sends `{ idToken }`; test now asserts `body.idToken`; no `body.token` references remain    |

---

### Data-Flow Trace (Level 4)

Not applicable. Modified files are test files and a context provider; no component that fetches and renders dynamic data was changed. The AuthContext changes affect runtime logic (comparison operator), not data fetching.

---

### Behavioral Spot-Checks

| Behavior                                              | Check                                                             | Result                            | Status  |
| ----------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- | ------- |
| `session.expiresAt * 1000 < Date.now()` in AuthContext | `grep -n "expiresAt" AuthContext.tsx`                           | Line 57 confirmed                 | ✓ PASS  |
| No ms-scale fixtures remain in AuthContext.test.tsx   | grep for `Date.now() + 3600_000` or `Date.now() - 1000`         | Zero matches                      | ✓ PASS  |
| No `body.token` assertion remains in authService.test | grep for `body\.token`                                           | Zero matches                      | ✓ PASS  |
| All 5 fixtures use seconds-scale                      | grep for `expiresAt` in AuthContext.test.tsx                     | 5 fixture lines, all use `Math.floor(Date.now() / 1000)` | ✓ PASS  |
| Commits documented in SUMMARY exist in git log        | `git log --oneline`                                              | ea75f10, a49d4ac, 92cc2f4 present | ✓ PASS  |
| API handler returns seconds (Option B unchanged)      | grep `expiresAt` in `packages/api/src/handlers/auth.ts`          | Line 470: `payload['exp'] as number` (JWT exp, seconds — unchanged) | ✓ PASS  |
| Web package unchanged                                 | grep `expiresAt` in `packages/web`                              | `packages/web/src/auth/session.ts:61` still uses `Math.floor(Date.now() / 1000)` comparison — unchanged | ✓ PASS  |

---

### Requirements Coverage

| Requirement | Source Plan  | Description                                                                                             | Status      | Evidence                                                                                               |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| SESSION-04  | 07-01-PLAN.md | On app resume, if stored session `expiresAt` is in the past, driver is shown re-login prompt           | ✓ SATISFIED | AuthContext.tsx:57 converts seconds to ms before comparison; SESSION-04 tests in AuthContext.test.tsx exercise both expired and valid paths with correct seconds-scale fixtures |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| —    | —    | None found | — | — |

No TODO/FIXME, placeholder stubs, empty implementations, or stale assertions detected in the three modified files.

---

### Human Verification Required

None. All success criteria are fully verifiable from static analysis of the source files and git history:

- The comparison operator change is a single-expression diff with deterministic mathematical correctness.
- The test fixture changes are mechanical unit conversions (× 1000 → ÷ 1000 at fixture side).
- The authService assertion fix is a property name rename with no behavioral ambiguity.

The full mobile test suite result (131 passing, 0 failing) is documented in the SUMMARY and supported by the three atomic commits in git history.

---

### Gaps Summary

No gaps. All four must-have truths are verified against the actual codebase:

1. `AuthContext.tsx:57` contains the exact string `session.expiresAt * 1000 < Date.now()` with an explanatory inline comment.
2. All 5 `expiresAt` fixture assignments in `AuthContext.test.tsx` use `Math.floor(Date.now() / 1000)` ± an offset in seconds; zero millisecond-scale values remain.
3. `authService.test.ts:143-144` type-asserts `{ idToken: string }` and checks `body.idToken`; no `body.token` references remain.
4. `packages/api/src/handlers/auth.ts` is unchanged — `expiresAt` is still `payload['exp']` (JWT seconds, Option B preserved).
5. `packages/web` is unchanged — web session code already compared against seconds correctly and was untouched.

SESSION-04 is satisfied. The v1.0 milestone gap closures BREAK-03, MISSING-01, and FLOW-BREAK-03 are all addressed.

---

_Verified: 2026-03-31T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
