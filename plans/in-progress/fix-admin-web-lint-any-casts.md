# Plan: Fix admin-web lint — replace `as any` casts in tenant-users test

**Branch:** TBD (create from main)
**Goal:** Unblock the `Lint` CI check on main by removing the 5 `@typescript-eslint/no-explicit-any` violations in `apps/admin-web/src/__tests__/tenant-users.test.ts`.

## Problem

`apps/admin-web/src/__tests__/tenant-users.test.ts` contains five `as any` casts (lines 47, 59, 74, 89, 103) used to attach `.mockResolvedValue(...)` to the mocked `adminFetch` / `adminFetchPaginated` functions. ESLint flags each as `@typescript-eslint/no-explicit-any`, failing the `Lint` CI job on every PR.

Introduced by commit `dea9c37` ("fix(admin-web): use adminFetch in tenant-users and remove duplicate test"). Has been blocking CI on `main` since 2026-04-11.

Note: `MEMORY.md` contains a note claiming `as any` is required to avoid TS overload errors — that guidance was specific to Prisma's `db.tenantUser.findFirst`, which has complex overloads. Plain `adminFetch` / `adminFetchPaginated` do not, so `vi.mocked(...)` should work here without type errors.

## Checklist

- [ ] In `apps/admin-web/src/__tests__/tenant-users.test.ts`, replace each `(adminFetch as any).mockResolvedValue(...)` with `vi.mocked(adminFetch).mockResolvedValue(...)` (and similarly for `adminFetchPaginated`).
- [ ] If `vi.mocked` triggers TS overload errors, fall back to `(adminFetch as unknown as ReturnType<typeof vi.fn>)` — still lint-clean, no `any`.
- [ ] Run `node node_modules/.bin/turbo run lint --filter=@pegasus/admin-web` — must be clean.
- [ ] Run `node node_modules/.bin/turbo run test --filter=@pegasus/admin-web` — existing tests must still pass.
- [ ] Run `node node_modules/.bin/turbo run typecheck --filter=@pegasus/admin-web` — zero type errors.

## Out of scope

- Other `as any` usages elsewhere in the repo.
- The `MEMORY.md` note about Prisma overloads — still accurate for its original context.

## Verification

CI `Lint` job green on the follow-up PR.
