# Phase 5: Login UX and Auth Guard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-28
**Phase:** 05-login-ux-and-auth-guard
**Mode:** discuss
**Areas discussed:** Error propagation, Password toggle style, Auth guard approach

## Gray Areas Presented

| Area                            | Selected |
| ------------------------------- | -------- |
| Error propagation (AUTH-05)     | ✓        |
| Password toggle style (AUTH-04) | ✓        |
| Auth guard approach (GUARD-01)  | ✓        |

## Decisions Made

### Error propagation (AUTH-05)

**Options presented:**

1. `login()` throws `AuthError` — login.tsx catches and maps to inline text _(chosen)_
2. AuthContext exposes `loginError` state
3. Bypass AuthContext — call authService.authenticate directly + new setSession()

**Decision:** `login()` throws `AuthError` on failure. Return type `Promise<boolean>` → `Promise<void>`.

### Password toggle style (AUTH-04)

**User clarification requested:** Explained why text vs icon pack — text matches existing uppercase label style; @expo/vector-icons ships with Expo SDK 54 so "bundle size" argument was weak, but text is more consistent with the screen's existing design language.

**Options presented:**

1. Text label `SHOW` / `HIDE` _(chosen)_
2. Eye icon from @expo/vector-icons

**Decision:** Uppercase text toggle (`SHOW`/`HIDE`) inside the input, matching label style.

### Auth guard approach (GUARD-01)

**Options presented:**

1. SplashScreen hides when auth state known (removes spinner) _(chosen)_
2. Keep spinner, add Stack.Protected

**Decision:** `SplashScreen.preventAutoHideAsync()` at module level; `SplashScreen.hideAsync()` on `isLoading → false`. `Stack.Protected` replaces `useEffect` redirect. Spinner removed.
