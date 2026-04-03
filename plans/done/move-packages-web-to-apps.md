# Move `packages/web` → `apps/web`

## Rationale

`packages/web` is a standalone deployable React SPA (the tenant-facing customer UI). It is not
a shared library consumed by other packages — it consumes `@pegasus/api-http`, `@pegasus/domain`,
and `@pegasus/theme` but nothing imports from it. By Turborepo convention, `packages/` is for
shared libraries and `apps/` is for standalone applications. Moving it alongside `apps/admin`,
`apps/mobile`, and `apps/longhaul` correctly reflects its nature.

The root `package.json` workspaces glob (`"packages/*"`, `"apps/*"`) already covers both
locations, so no workspace config change is needed.

---

## Steps

### 1. Move the directory

```bash
mv packages/web apps/web
```

### 2. Update CDK frontend assets stack

**File:** `packages/infra/lib/stacks/frontend-assets-stack.ts`

`__dirname` is `packages/infra/lib/stacks/`. `../../../../` resolves to the repo root.
Adjust the path to the built dist output:

```diff
- const distPath = path.join(__dirname, '../../../../packages/web/dist')
+ const distPath = path.join(__dirname, '../../../../apps/web/dist')
```

### 3. Update CDK frontend assets stack test

**File:** `packages/infra/lib/stacks/__tests__/frontend-assets-stack.test.ts`

The test comment (line ~35) references `packages/web/dist`:

```diff
- // If packages/web/dist exists (i.e. after a build), the deployment is created
+ // If apps/web/dist exists (i.e. after a build), the deployment is created
```

### 4. Update Cognito stack comment

**File:** `packages/infra/lib/stacks/cognito-stack.ts` (line ~287)

```diff
- // Used by packages/web for the tenant SSO login flow.
+ // Used by apps/web for the tenant SSO login flow.
```

### 5. Update CLAUDE.md

Replace `packages/web` references with `apps/web`:

- Tech stack table
- Monorepo package map

### 6. Update agent files

**`dolas/agents/project/DECISIONS.md`** — update `packages/web` reference:

```diff
- **Client-Side SPA Architecture**: `packages/web` (Tenant view) and `apps/admin` (Administrative view)
+ **Client-Side SPA Architecture**: `apps/web` (Tenant view) and `apps/admin` (Administrative view)
```

---

## Verification

After moving:

```bash
# Typecheck passes (web imports domain and api-http)
node node_modules/.bin/turbo run typecheck

# Web builds successfully
node node_modules/.bin/turbo run build --filter=@pegasus/web

# CDK synth produces valid template (frontend-assets-stack resolves dist path)
cd packages/infra && npm run synth
```
