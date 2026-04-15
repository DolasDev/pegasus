# Plan: Add beforeLoad auth guards to tenant-web routes

**Branch:** TBD (create from main)
**Goal:** Centralize auth checks in tenant-web using TanStack Router `beforeLoad` guards, matching the pattern admin-web already uses.

## Problem

tenant-web has no route-level auth guards. Protected routes read `getSession()` ad-hoc in component bodies. admin-web already uses `beforeLoad` + `authGuard()` correctly (`apps/admin-web/src/routes/_auth.tsx`). tenant-web should adopt the same pattern to prevent flash of protected content and centralize the redirect logic.

## Checklist

### Step 1 — Write test for auth guard behavior

- [ ] Write `apps/tenant-web/src/__tests__/auth-guard.test.ts`:
  - When session is null, guard throws redirect to `/login`
  - When session exists and is not expired, guard passes (no throw)
  - When session is expired, guard clears session and throws redirect to `/login`

### Step 2 — Implement auth guard

- [ ] Create `apps/tenant-web/src/auth/guard.ts`:
  - Export `authGuard()` function
  - Reads `getSession()` — if null or expired, `throw redirect({ to: '/login' })`
- [ ] Tests pass

### Step 3 — Wire into route tree

- [ ] Create `apps/tenant-web/src/routes/_auth.tsx` — layout route with `beforeLoad: authGuard`
- [ ] Update `apps/tenant-web/src/router.tsx` — nest all protected routes under `_auth` layout
- [ ] Public routes (`/login`, `/login/callback`, `/landing`) remain outside `_auth`
- [ ] Remove any ad-hoc `getSession()` checks from individual route components

### Step 4 — Verify

- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/tenant-web`
- [ ] `node node_modules/.bin/turbo run typecheck`

## Files modified

- `apps/tenant-web/src/auth/guard.ts` (new)
- `apps/tenant-web/src/__tests__/auth-guard.test.ts` (new)
- `apps/tenant-web/src/routes/_auth.tsx` (new)
- `apps/tenant-web/src/router.tsx` (restructure route tree)
- Various route files (remove ad-hoc session checks if present)

## Notes

This mirrors admin-web's `_auth.tsx` pattern exactly, keeping the two web apps consistent.
