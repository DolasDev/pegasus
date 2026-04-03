# Move `packages/api` → `apps/api`

## Rationale

`packages/api` is a standalone deployable backend service (Hono HTTP server, runs on AWS Lambda
and as a Windows Service). It is not a shared library consumed by other packages. By Turborepo
convention, `packages/` is for shared libraries and `apps/` is for standalone applications.
Moving it alongside `apps/admin`, `apps/web`, and `apps/mobile` correctly reflects its nature.

The root `package.json` workspaces glob (`"packages/*"`, `"apps/*"`) already covers both
locations, so no workspace config change is needed.

---

## Steps

### 1. Move the directory

```bash
mv packages/api apps/api
```

### 2. Update CDK Lambda entry point

**File:** `packages/infra/lib/stacks/api-stack.ts`

`__dirname` is `packages/infra/lib/stacks/`. Adjust the relative path:

```diff
- entry: path.join(__dirname, '../../../api/src/lambda.ts'),
+ entry: path.join(__dirname, '../../../../apps/api/src/lambda.ts'),
```

### 3. Update Cognito stack comment

**File:** `packages/infra/lib/stacks/cognito-stack.ts` (line ~112)

```diff
- // Entry point is in packages/api so Lambda code stays alongside app code.
+ // Entry point is in apps/api so Lambda code stays alongside app code.
```

### 4. Update E2E playwright config

**File:** `apps/e2e/playwright.config.ts`

`__dirname` is `apps/e2e/`. Adjust relative path:

```diff
- command: `node ../../node_modules/.bin/tsx ../../packages/api/src/server.ts`,
+ command: `node ../../node_modules/.bin/tsx ../api/src/server.ts`,
```

### 5. Update E2E global setup

**File:** `apps/e2e/global-setup.ts`

```diff
- const apiDir = path.resolve(__dirname, '../../packages/api')
+ const apiDir = path.resolve(__dirname, '../api')
```

### 6. Update docker-compose.yml comments

**File:** `docker-compose.yml`

```diff
- #   cd packages/api
- # Set DATABASE_URL and DIRECT_URL in packages/api/.env before running
- # migrations (see packages/api/.env.example for the local connection string).
+ #   cd apps/api
+ # Set DATABASE_URL and DIRECT_URL in apps/api/.env before running
+ # migrations (see apps/api/.env.example for the local connection string).
```

### 7. Update CLAUDE.md

Replace all `packages/api` references with `apps/api`:

- Tech stack table
- Key commands section (`packages/api: npm run db:*`)
- Testing table (Integration row)
- Memory file note about repositories location

### 8. Update agent files

**`dolas/agents/project/context.md`** — update `(packages/api)` reference

**`dolas/agents/project/DECISIONS.md`** — update two `packages/api` references and one `packages/web`
reference (the latter is a separate move; update if doing both together)

**`dolas/agents/project/PATTERNS.md`** — update `packages/api/src/lib/logger.ts` reference

---

## Verification

After moving:

```bash
# Typecheck passes
node node_modules/.bin/turbo run typecheck

# API unit tests pass (no DB needed)
node node_modules/.bin/turbo run test --filter=@pegasus/api

# CDK synth produces valid template
cd packages/infra && npm run synth
```
