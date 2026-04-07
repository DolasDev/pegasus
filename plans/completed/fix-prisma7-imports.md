# Fix Prisma 7 Import Errors After Dependency Migration

**Branch:** `fix/prisma7-typecheck`
**Prerequisite:** All 9 dependency migration PRs (#28-#36) are merged. Integration fix commit on main.

## Problem

After merging the Prisma 6→7 upgrade (PR #35), `@prisma/client` no longer exports `PrismaClient` and `Prisma` as named exports in the way TypeScript resolves them. Running `npx turbo run typecheck --filter=@pegasus/api` produces ~60 errors like:

```
error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
```

**Note:** Tests pass (740/740) — this is a typecheck-only issue. The runtime works because esbuild/Vite resolve the exports correctly, but `tsc --noEmit` with `moduleResolution: "bundler"` (set by PR #33's TS 6 migration) does not.

## Root Cause

Prisma 7 changed its package structure:

- `@prisma/client/package.json` has `"main": "default.js"` and `"types": "default.d.ts"`
- `default.d.ts` contains: `export * from '.prisma/client/default'`
- The generated client at `node_modules/.prisma/client/default/client.ts` exports `PrismaClient` and `Prisma` as named exports
- With `moduleResolution: "bundler"` (TS 6), TypeScript follows the `exports` field which maps `.` → `default.d.ts` → re-exports from `.prisma/client/default`
- The re-export chain resolves to a module whose shape TS sees as `{ default: typeof import("...") }` rather than exposing named exports

The API's tsconfig inherits `moduleResolution: "bundler"` from `tsconfig.base.json` (changed in PR #33). The old `moduleResolution: "node"` worked because it used `main`/`types` fields directly.

## Investigation Steps

1. Check if `prisma generate` with a different `output` path fixes the resolution
2. Check if adding `"@prisma/client"` to `paths` in the API tsconfig fixes it
3. Check if the API tsconfig can override `moduleResolution` back to `"node16"` (may be needed for CJS compatibility anyway since the API runs on Lambda as CJS)
4. Check Prisma 7 docs for the recommended import pattern with TypeScript 6 / bundler resolution

## Likely Fix Options

### Option A: Override moduleResolution in API tsconfig

```json
// apps/api/tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "node16"
  }
}
```

This would make the API package use the old resolution strategy that works with Prisma 7's re-export pattern. The API is a Node.js Lambda (CJS), so `node16` is arguably more correct anyway.

### Option B: Import from generated path

Change all imports from:

```ts
import { PrismaClient } from '@prisma/client'
```

to:

```ts
import { PrismaClient } from '.prisma/client/default'
```

This bypasses the re-export but couples code to the generated output path.

### Option C: Use Prisma's recommended TS 6 import pattern

Prisma 7 may have a documented way to import with bundler resolution. Check docs.

## Files Affected (~60 import sites)

### Production code (must fix):

- `src/db.ts` — PrismaClient
- `src/app.ts`, `src/app.server.ts` — PrismaClient
- `src/types.ts` — PrismaClient
- `src/lib/prisma.ts` — PrismaClient
- `src/cognito/pre-token.ts` — PrismaClient
- `src/middleware/tenant.ts`, `src/middleware/m2m-app-auth.ts` — PrismaClient
- `src/handlers/admin/tenants.ts`, `src/handlers/admin/tenant-users.ts`, `src/handlers/admin/audit.ts` — Prisma namespace
- `src/handlers/auth.ts` — implicit any on parameter
- `src/repositories/*.ts` (8 files) — PrismaClient, Prisma

### Test code:

- `src/app.test.ts` — Prisma
- `src/handlers/*.test.ts` (12+ files) — PrismaClient
- `src/repositories/__tests__/*.test.ts` (6 files) — PrismaClient
- `src/lib/__tests__/prisma-tenant-isolation.test.ts` — PrismaClient
- `src/handlers/admin/tenants.test.ts` — Prisma (also has `err` is unknown issue)

### Also affected:

- `apps/e2e/global-setup.ts` — dynamic import of PrismaClient (already patched with `as Record<string, any>`)

## Verification

```bash
npx turbo run typecheck --filter=@pegasus/api
npx turbo run test --filter=@pegasus/api
```

## Also in this PR (already staged, not yet committed)

These tsconfig fixes for TS 6 vitest globals should be committed in the same PR:

- `apps/tenant-web/tsconfig.json` — add `"types": ["vitest/globals"]`
- `apps/admin-web/tsconfig.json` — add `"types": ["vitest/globals"]`, bump lib to ES2022
- `apps/longhaul/tsconfig.json` — add `"types": ["vitest/globals", "node"]`
