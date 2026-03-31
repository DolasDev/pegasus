# Phase 7: Fix Session Expiry and Stale Tests — Research

**Researched:** 2026-03-31
**Domain:** Cross-package expiresAt units contract (JWT seconds vs Date.now() milliseconds); stale test fixture correction
**Confidence:** HIGH

---

<phase_requirements>

## Phase Requirements

| ID         | Description                                                                                                  | Research Support                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| SESSION-04 | On app resume, if stored session's `expiresAt` is in the past, driver is shown a re-login prompt            | BREAK-03 root cause confirmed. Fix requires either API-side unit conversion or AuthContext comparison correction. Cross-package impact on web identified. |

</phase_requirements>

---

## Summary

Phase 7 is a surgical bug-fix phase with three independent defects to close. The primary defect (BREAK-03) is a cross-phase units mismatch: `packages/api/src/handlers/auth.ts:470` stores `payload['exp']` as-is (JWT standard: Unix epoch seconds, ~1.7×10⁹), while `apps/mobile/src/context/AuthContext.tsx:56` compares `session.expiresAt < Date.now()` (milliseconds, ~1.7×10¹²). Because seconds are always less than milliseconds, every real authenticated session is immediately evicted on the first `AppState active` event — SESSION-04 is functionally broken for all real device logins. Phase 3 unit tests masked this by using millisecond-scale fixture values (`Date.now() + 3600_000`).

The secondary defect (MISSING-01) is a stale test assertion: `apps/mobile/src/auth/authService.test.ts:143-144` parses the fetch body as `{ token: string }` and asserts `body.token === 'raw-id-token'`, but Phase 6 already fixed `authService.ts:71` to send `{ idToken }`. The test assertion was not updated. Production code is correct; only the test is wrong.

**Critical planning risk — internal inconsistency in success criteria:** The phase success criteria contain a contradiction (documented in the Open Questions section below). SC#1 says change `auth.ts:470` to `* 1000` (API returns milliseconds). SC#2 says AuthContext.test.tsx should use "seconds-scale" fixtures like `Date.now() / 1000 + 3600`. If the API returns milliseconds, a test fixture representing a real session response should be milliseconds-scale, not seconds-scale. The planner must resolve this before writing tasks. Research provides both fix interpretations and their full scope.

**Primary recommendation:** Resolve the SC inconsistency before planning. The two internally-consistent interpretations are (A) fix API to return ms + update AuthContext.test.tsx to ms-scale + update web session comparison and web tests, or (B) fix AuthContext comparison to `session.expiresAt * 1000 < Date.now()` + update AuthContext.test.tsx to seconds-scale + leave auth.ts unchanged.

---

## Standard Stack

### Core (what this phase touches)

| File | Location | What it does |
| ---- | -------- | ------------ |
| `auth.ts` | `packages/api/src/handlers/auth.ts:470` | Extracts and returns `expiresAt` from JWT `exp` claim |
| `AuthContext.tsx` | `apps/mobile/src/context/AuthContext.tsx:56` | Compares `session.expiresAt < Date.now()` on AppState active |
| `authService.ts` | `apps/mobile/src/auth/authService.ts:71` | Posts `{ idToken }` to validate-token (already fixed in Phase 6) |
| `auth.test.ts` | `packages/api/src/handlers/auth.test.ts:455` | Asserts `data['expiresAt']` value after validate-token |
| `AuthContext.test.tsx` | `apps/mobile/src/context/AuthContext.test.tsx` | 5 fixtures with millisecond-scale `expiresAt` |
| `authService.test.ts` | `apps/mobile/src/auth/authService.test.ts:143-144` | Stale `body.token` assertion |
| `session.ts` | `packages/web/src/auth/session.ts:61` | Web expiry comparison — POTENTIALLY AFFECTED (see below) |
| `session.test.ts` | `packages/web/src/__tests__/session.test.ts` | Web session tests — POTENTIALLY AFFECTED |

---

## Architecture Patterns

### The expiresAt Contract

JWT standard: `exp` claim is Unix epoch in **seconds** (~1.7×10⁹ for dates in 2025–2026).

`Date.now()` returns Unix epoch in **milliseconds** (~1.7×10¹² for same dates).

The ratio is exactly 1000. A seconds-scale value is always smaller than a milliseconds-scale value for the same point in time. Any comparison between the two without explicit conversion is a runtime logic error.

### Two Fix Options

**Option A — API returns milliseconds:**
- Change `auth.ts:470`: `const expiresAt = (payload['exp'] as number) * 1000`
- AuthContext comparison `session.expiresAt < Date.now()` is now correct (both ms)
- AuthContext.test.tsx fixtures should use ms-scale: `Date.now() + 3600_000` (already the current value — or could normalize to `Math.floor(Date.now() / 1000) * 1000 + 3_600_000` for clarity)
- auth.test.ts:455 must update: `expect(data['expiresAt']).toBe(9999999999 * 1000)` = `9999999999000`
- **Cross-package impact:** `packages/web/src/auth/session.ts:61` currently compares `parsed.expiresAt < Math.floor(Date.now() / 1000)` — this expects seconds. If the API now returns ms, the web comparison treats a ms value (~1.7e12) as bigger than `Math.floor(Date.now()/1000)` (~1.7e9), so web sessions would NEVER expire. The web comparison must change to `parsed.expiresAt < Date.now()` AND web test fixtures must update to ms-scale.

**Option B — AuthContext converts at comparison (no API change):**
- Change `AuthContext.tsx:56`: `session.expiresAt * 1000 < Date.now()`
- auth.ts:470 stays as `payload['exp'] as number` (no change)
- AuthContext.test.tsx fixtures must change to seconds-scale: `Math.floor(Date.now() / 1000) + 3600`
- auth.test.ts:455 stays as `expect(data['expiresAt']).toBe(9999999999)` (no change)
- `expiredSession` fixtures in AuthContext.test.tsx currently use `Date.now() - 1000` — must change to `Math.floor(Date.now() / 1000) - 1`
- No web package impact (API continues returning seconds; web already divides by 1000)

### Web Package State (Confirmed by Research)

`packages/web/src/auth/session.ts:61`:
```typescript
// Discard expired sessions (expiresAt is Unix epoch seconds)
if (parsed.expiresAt < Math.floor(Date.now() / 1000)) {
```

`packages/web/src/__tests__/session.test.ts` fixtures use seconds-scale:
```typescript
expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
```

The web package is already internally consistent using seconds. It also calls `validate-token` and stores the returned `expiresAt`. **Option A would break the web package silently — the web tests would pass (stale scale), but production sessions would never expire on the web client.**

### Consistency Recommendation

Option B is scope-contained and does not touch the web package. Option A requires updating 3 packages (api, mobile, web) and is higher risk for a bug-fix phase. The phase description only lists 3 files in its success criteria and does not mention the web package.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
| ------- | ----------- | ----------- | --- |
| Unit conversion | Custom Date math class | `Date.now()` + explicit `* 1000` or `/ 1000` at the conversion point | Standard JS; one-liner |
| JWT expiry comparison | Custom JWT parser | `payload['exp']` already extracted by jose — just fix the scale | jose already does the hard work |

---

## Current State Audit (Confirmed by File Reads)

### BREAK-03: expiresAt units mismatch

**`packages/api/src/handlers/auth.ts:470` (current):**
```typescript
const expiresAt = payload['exp'] as number
```
Returns seconds (~9999999999 in test mocks, ~1743000000 for real Cognito tokens).

**`apps/mobile/src/context/AuthContext.tsx:56` (current):**
```typescript
if (nextState === 'active' && session !== null && session.expiresAt < Date.now()) {
```
`Date.now()` returns ms (~1743000000000). Real `expiresAt` of ~1.7e9 is ALWAYS less than ~1.7e12 — every session is immediately expired on first resume.

### MISSING-01: Stale body.token assertion

**`apps/mobile/src/auth/authService.test.ts:143-144` (current — WRONG):**
```typescript
const body = JSON.parse(validateCall[1].body as string) as { token: string }
expect(body.token).toBe('raw-id-token')
```

**`apps/mobile/src/auth/authService.ts:71` (current — CORRECT):**
```typescript
body: JSON.stringify({ idToken }),
```

The production code sends `{ idToken }` but the test type-asserts `{ token }` and checks `body.token`. After Phase 6, `body.token` is `undefined`. The test assertion at line 144 fails.

**Fix (2 lines):**
```typescript
const body = JSON.parse(validateCall[1].body as string) as { idToken: string }
expect(body.idToken).toBe('raw-id-token')
```

### AuthContext.test.tsx: All millisecond-scale fixtures

All 5 `expiresAt` fixture values in `AuthContext.test.tsx` use milliseconds:

| Line | Variable | Current Value | Fix (Option A) | Fix (Option B) |
| ---- | -------- | ------------- | -------------- | -------------- |
| 25 | `mockSession` | `Date.now() + 3600_000` | keep or normalize | `Math.floor(Date.now() / 1000) + 3600` |
| 152 | `stored` (checkSession) | `Date.now() + 3600_000` | keep or normalize | `Math.floor(Date.now() / 1000) + 3600` |
| 196 | `expiredSession` (SESSION-04) | `Date.now() - 1000` | `Date.now() - 1000` (ok, ms past) | `Math.floor(Date.now() / 1000) - 1` |
| 220 | `validSession` (SESSION-04) | `Date.now() + 3600_000` | keep or normalize | `Math.floor(Date.now() / 1000) + 3600` |
| 241 | `expiredSession` (background test) | `Date.now() - 1000` | `Date.now() - 1000` (ok, ms past) | `Math.floor(Date.now() / 1000) - 1` |

Note: Under Option A the "expired" fixtures at lines 196 and 241 are already ms-scale past values and remain valid.

### auth.test.ts: expiresAt assertion (only if Option A chosen)

**`packages/api/src/handlers/auth.test.ts:455` (current):**
```typescript
expect(data['expiresAt']).toBe(9999999999)
```

Under Option A, auth.ts now returns `9999999999 * 1000 = 9999999999000`. This assertion must change:
```typescript
expect(data['expiresAt']).toBe(9999999999000)
```

Under Option B, no change needed.

---

## Common Pitfalls

### Pitfall 1: Overlooking the web package impact

**What goes wrong:** Changing auth.ts:470 to return milliseconds (Option A) without updating `packages/web/src/auth/session.ts:61` silently makes web sessions immortal — they never expire because ms > `Math.floor(Date.now()/1000)` always.
**Why it happens:** The web package calls the same validate-token endpoint and stores the returned `expiresAt`. Different comparison logic (`< Math.floor(Date.now()/1000)`) breaks silently — tests pass if fixtures aren't updated.
**How to avoid:** Either choose Option B (no API change, no web impact) or explicitly include web updates in the plan.
**Warning signs:** Web session.test.ts still passes after changing the API — a false green.

### Pitfall 2: Treating the "expired" test fixtures differently

**What goes wrong:** Under Option B, `expiredSession` fixtures use `Date.now() - 1000`. After the fix, AuthContext compares `session.expiresAt * 1000 < Date.now()`. A fixture value of `Date.now() - 1000` would need to be seconds-scale: `Math.floor(Date.now() / 1000) - 1` is correct (1 second in the past). The current value `Date.now() - 1000` is also 1 second in the past in ms scale — it still works for the expired case only if AuthContext.tsx still does `session.expiresAt < Date.now()`. After fix to `session.expiresAt * 1000 < Date.now()`, a fixture of `Date.now() - 1000` ms ≈ 1743292800000 ms, multiplied by 1000 = 1.7e15 which is far in the future — the fixture would no longer appear expired.
**How to avoid:** Under Option B, ALL fixtures including "expired" ones must convert to seconds scale.

### Pitfall 3: auth.test.ts expiresAt assertion (Option A only)

**What goes wrong:** Changing auth.ts:470 to `* 1000` but not updating `auth.test.ts:455` which asserts `9999999999`. The test will fail with `received 9999999999000, expected 9999999999`.
**How to avoid:** Under Option A, update the assertion to `9999999999000`.

### Pitfall 4: authService.test.ts mockSession expiresAt vs the assertion fix

**What goes wrong:** `mockSession.expiresAt = 9999999999` in authService.test.ts (line 10). This is already seconds-scale (JWT-style), which is what the real API currently returns. The MISSING-01 fix is independent of the expiresAt unit fix — do not conflate the two changes.
**How to avoid:** Fix MISSING-01 (lines 143-144) without touching the `mockSession.expiresAt` value (which is fine for its context).

---

## Code Examples

### Option B Fix — AuthContext.tsx (recommended for minimal scope)

```typescript
// Source: AuthContext.tsx:56 — after fix
// session.expiresAt is seconds (JWT standard); Date.now() is milliseconds
if (nextState === 'active' && session !== null && session.expiresAt * 1000 < Date.now()) {
  logout()
}
```

### Option B Fix — AuthContext.test.tsx fixtures (non-expired)

```typescript
// All "valid" fixtures: seconds-scale
expiresAt: Math.floor(Date.now() / 1000) + 3600,  // 1 hour from now in seconds
```

### Option B Fix — AuthContext.test.tsx expired fixtures

```typescript
// All "expired" fixtures: seconds in the past
expiresAt: Math.floor(Date.now() / 1000) - 1,  // 1 second ago in seconds
```

### MISSING-01 Fix — authService.test.ts:143-144

```typescript
// Before (WRONG):
const body = JSON.parse(validateCall[1].body as string) as { token: string }
expect(body.token).toBe('raw-id-token')

// After (CORRECT):
const body = JSON.parse(validateCall[1].body as string) as { idToken: string }
expect(body.idToken).toBe('raw-id-token')
```

### Option A Fix — auth.ts:470 (if chosen)

```typescript
// Before:
const expiresAt = payload['exp'] as number
// After:
const expiresAt = (payload['exp'] as number) * 1000
```

---

## Validation Architecture

### Test Framework

| Property | Value |
| -------- | ----- |
| Framework | Vitest (packages/api), Jest (apps/mobile) |
| Config file | packages/api/vitest.config.ts / apps/mobile/jest.config.js |
| Quick run (mobile) | `node node_modules/.bin/jest --testPathPattern=authService.test.ts --testPathPattern=AuthContext.test.tsx` |
| Quick run (api) | `node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts` |
| Full suite | `node node_modules/.bin/turbo run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | File | Status |
| ------ | -------- | --------- | ---- | ------ |
| SESSION-04 | Expired session triggers logout on foreground resume | Unit | `apps/mobile/src/context/AuthContext.test.tsx` | Exists — fixtures need update |
| SESSION-04 | validate-token returns correct millisecond expiresAt (Option A only) | Unit | `packages/api/src/handlers/auth.test.ts:455` | Exists — assertion needs update under Option A |
| AUTH-03 | authService sends `{ idToken }` to validate-token | Unit | `apps/mobile/src/auth/authService.test.ts:143-144` | Exists — type assertion and expect need fix |

### Wave 0 Gaps

None — all required test files already exist. Changes are modifications to existing test code, not new test file creation.

---

## Open Questions

1. **Which fix option should the planner use? (MUST resolve before creating tasks)**
   - What we know: SC#1 says change `auth.ts:470` to `* 1000` (Option A). SC#2 says test fixtures should be "seconds-scale" like `Date.now() / 1000 + 3600`. These are mutually contradictory: if the API returns ms, test fixtures simulating the API response should be ms-scale.
   - What's unclear: Whether SC#2's example (`Date.now() / 1000 + 3600`) is a copy-paste error (should be `Date.now() + 3600_000`) or whether the intent was Option B all along (no API change, fix AuthContext comparison).
   - Recommendation: **Choose Option B.** It is: (a) scope-contained — 3 files, no web package risk; (b) aligns with the web package convention (seconds throughout the API contract); (c) SC#2 explicitly shows seconds-scale fixtures which match Option B; (d) avoids the `auth.test.ts:455` change. If Option A is truly intended, the planner must also include web package updates.

2. **Does auth.test.ts:455 need updating?**
   - What we know: Under Option A it must change from `9999999999` to `9999999999000`. Under Option B it stays as-is.
   - Recommendation: Resolved by the Option A/B decision above.

3. **Are there any other callers of validate-token that consume expiresAt?**
   - What we know: `packages/web/src/routes/login.callback.tsx:144` and `packages/web/src/routes/login.tsx:218` both call validate-token and pass the result to `setSession()`. Web session.ts compares in seconds.
   - What's unclear: Whether admin package calls validate-token (research found no hits in `apps/admin`).
   - Recommendation: Under Option B, no action needed. Under Option A, both web callers are affected.

---

## Environment Availability

Step 2.6: SKIPPED — This phase is purely code and test changes. No external services, databases, or CLI tools beyond the existing project test infrastructure are required.

---

## Sources

### Primary (HIGH confidence)

All findings are based on direct file reads from the repository. No external library research required — the phase involves only logic corrections and test fixture updates within existing files.

| File | Lines | Finding |
| ---- | ----- | ------- |
| `packages/api/src/handlers/auth.ts` | 470 | `const expiresAt = payload['exp'] as number` — confirmed seconds |
| `apps/mobile/src/context/AuthContext.tsx` | 56 | `session.expiresAt < Date.now()` — confirmed ms comparison |
| `apps/mobile/src/context/AuthContext.test.tsx` | 25, 152, 196, 220, 241 | All 5 fixtures confirmed ms-scale |
| `apps/mobile/src/auth/authService.test.ts` | 143-144 | Confirmed stale `body.token` assertion |
| `apps/mobile/src/auth/authService.ts` | 71 | `body: JSON.stringify({ idToken })` — correct, matches BREAK-01 fix |
| `packages/web/src/auth/session.ts` | 61 | `parsed.expiresAt < Math.floor(Date.now() / 1000)` — web uses seconds |
| `packages/web/src/__tests__/session.test.ts` | 8, 37 | Web fixtures confirmed seconds-scale |
| `packages/api/src/handlers/auth.test.ts` | 440, 455 | `exp: 9999999999` mock, assertion `toBe(9999999999)` |
| `.planning/v1.0-MILESTONE-AUDIT.md` | BREAK-03, MISSING-01 | Audit root cause and fix descriptions confirmed |

---

## Metadata

**Confidence breakdown:**

- Bug root causes: HIGH — confirmed by direct file reads, cross-referenced with audit
- Fix scope (Option B): HIGH — all affected lines identified, web package impact mapped
- Fix scope (Option A): HIGH with caveat — web impact is real; phase success criteria are internally inconsistent
- Test changes: HIGH — all fixture lines identified with exact current values and required new values

**Research date:** 2026-03-31
**Valid until:** This research covers static code — valid until any of the 7 files listed are modified
