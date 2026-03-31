---
phase: 6
slug: fix-mobile-token-validation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-31
audited: 2026-03-31
---

# Phase 6: Fix Mobile Token Validation — Validation

**Phase Goal:** The `validate-token` endpoint accepts both web and mobile Cognito app client audiences; the BREAK-01 field name fix is committed; the Session type reflects the full API response shape.

---

## Test Infrastructure

| Property               | Value                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **Framework**          | Vitest (packages/api) + Jest (apps/mobile)                                                    |
| **Config file**        | `packages/api/vitest.config.ts` / `apps/mobile/jest.config.js`                               |
| **Quick run (api)**    | `node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts`                    |
| **Quick run (mobile)** | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern=authService`           |
| **Full suite command** | `node node_modules/.bin/turbo run test`                                                       |
| **Estimated runtime**  | ~600ms (API quick), ~15s (mobile quick), ~60s (full)                                          |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command
- **After every plan wave:** Run full suite
- **No DATABASE_URL required** — validate-token makes no DB calls; all jose functions mocked
- **Max feedback latency:** ~1 second

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status   |
| -------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | -------- |
| 06-01-01 | 01   | 1    | AUTH-03     | unit (api) | `node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts` | ✅ `packages/api/src/handlers/auth.test.ts` | ✅ green |
| 06-01-02 | 01   | 1    | AUTH-03     | unit (mobile) | `cd apps/mobile && node ../../node_modules/.bin/jest --testPathPattern=authService` | ✅ `apps/mobile/src/auth/authService.test.ts` | ✅ green |
| 06-02-01 | 02   | 2    | AUTH-03     | unit (api) | `node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts` | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

All test files existed before this phase. Changes were modifications to existing files.

- [x] `packages/api/src/handlers/auth.test.ts` — 9-test "POST /api/auth/validate-token" describe block added (vi.hoisted + vi.mock jose pattern)
- [x] `apps/mobile/src/auth/authService.test.ts` — `body.idToken` assertion updated (commit 92cc2f4 via Phase 07)
- [x] `apps/mobile/src/auth/authService.test.ts` + `apps/mobile/src/context/AuthContext.test.tsx` — `ssoProvider: null` added to all mockSession objects

---

## Unit Test Coverage: validate-token Endpoint

| # | Scenario | Expected Status | Test |
|---|----------|----------------|------|
| 1 | Tenant client ID token (valid) | 200 | `it('returns 200 with session claims when tenant client ID token is valid')` |
| 2 | Mobile client ID token (valid, with SSO identity) | 200 | `it('returns 200 with ssoProvider populated when mobile token includes identities claim')` |
| 3 | Unknown audience rejected | 401 UNAUTHORIZED | `it('returns 401 UNAUTHORIZED when token audience does not match')` |
| 4 | Expired token | 401 TOKEN_EXPIRED | `it('returns 401 TOKEN_EXPIRED when token is expired')` |
| 5 | Wrong token_use (access token) | 401 UNAUTHORIZED | `it('returns 401 UNAUTHORIZED when token_use is "access" instead of "id"')` |
| 6 | Missing sub or email claims | 401 UNAUTHORIZED | `it('returns 401 UNAUTHORIZED when required claims are missing')` |
| 7 | Missing custom:tenantId or custom:role | 403 FORBIDDEN | `it('returns 403 FORBIDDEN when tenant or role claims are missing')` |
| 8 | Env vars not set | 500 INTERNAL_ERROR | `it('returns 500 INTERNAL_ERROR when env vars are not configured')` |
| 9 | Invalid/unparseable JWT | 401 UNAUTHORIZED | `it('returns 401 UNAUTHORIZED for invalid JWT')` |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |
| End-to-end mobile auth on real device | AUTH-03 | Requires live Cognito user pool + deployed Lambda | Install dev build, login with driver credentials, confirm home screen reached |
| COGNITO_MOBILE_CLIENT_ID set in Lambda env | AUTH-03 | Requires AWS console or deployment run | Check Lambda environment variables after `npm run deploy` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 1s (32/32 API tests in 640ms)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-03-31

---

## Validation Audit 2026-03-31

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 3     |
| Escalated  | 0     |

AUTH-03 verified by: 9-test validate-token describe block in `auth.test.ts` (cases 1-9 above) + `authService.test.ts` idToken forwarding test.
32/32 API auth tests green. 131/131 mobile tests green.
