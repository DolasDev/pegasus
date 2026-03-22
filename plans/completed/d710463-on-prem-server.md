# On-Premises Windows Server Deployment for Pegii API

**Branch:** `feature/on-prem-server`
**Goal:** Add a standalone Node.js HTTP entry point so the Hono API can run on a Windows server as a Windows Service.

## Implementation Checklist

### 1. Prisma: add Windows binary target

- [x] `packages/api/prisma/schema.prisma` — add `"windows"` to `binaryTargets`

### 2. Conditional auth middleware

- [x] Write test: `packages/api/src/__tests__/optional-auth.test.ts`
- [x] `packages/api/src/app.ts` — wrap auth middleware in `SKIP_AUTH` check; set stub context values when skipped

### 3. Node.js HTTP entry point

- [x] Write test: `packages/api/src/__tests__/server.test.ts`
- [x] Create `packages/api/src/server.ts`
- [x] `packages/api/package.json` — add `@hono/node-server`, `"start"` and `"start:dev"` scripts

### 4. Deep health check

- [x] Write test: `packages/api/src/__tests__/health.test.ts`
- [x] `packages/api/src/app.ts` — enhance `/health` with `?deep=true`

### 5. Windows Service installer

- [x] Create `packages/api/service/install.js`
- [x] Create `packages/api/service/uninstall.js`
- [x] `packages/api/package.json` — add `node-windows` (optional), service scripts

### 6. Environment configuration

- [x] `packages/api/.env.example` — add `PORT`, `HOST`, `SKIP_AUTH`, on-prem docs

### 7. Verify

- [x] `npm test` passes (5/5 packages, 521 tests)
- [x] `npm run typecheck` — no new type errors (pre-existing admin errors only)
