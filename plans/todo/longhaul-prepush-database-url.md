# Pre-push hook fails locally on tests that require `DATABASE_URL`

Captured 2026-05-11 during the longhaul-port audit-and-remediation sweep.
Updated 2026-05-12 with findings + the first fix (lazy Prisma client).

## Status

- ✅ **Fixed: `@pegasus/api` handler tests failing at module load** — `apps/api/src/db.ts` now exports a lazy Proxy instead of eagerly calling `new PrismaClient()` at import time. Importing `./db` is now side-effect-free w.r.t. `DATABASE_URL`; the client is created on first *use*. Handler tests that mock the repos (quotes/users/events/orders/settings/api-clients/…) no longer collapse at collection when `DATABASE_URL` is unset. (PR: see below.)
- ✅ **Not a real bug: missing `@aws-sdk/*` / `@hono/swagger-ui` modules** — these *are* declared in `apps/api/package.json` (and `@aws-sdk/client-cloudwatch` / `@aws-sdk/client-ec2` in `apps/vpn-agent/package.json`). The local `node_modules` was just stale; `npm install` (or `npm ci`) materialises them. Worker reports of "package.json missing the dep" were a misdiagnosis. CI (`npm ci`) was never affected.
- ✅ **Not a real bug: `users.repository` "Prisma schema drift"** — the *generated* client under `node_modules/@prisma/client` was stale (missing `legacyWindowsUsername`, `roleNames`, `policyStoreId`). `cd apps/api && prisma generate` regenerates it; the schema itself is fine. CI runs `prisma generate` in the Test job, so it was never affected.
- ⚠️ **Newly found, separate issue: `@pegasus/infra` tests fail locally with `PathNotUnderRoot`** — `lib/stacks/__tests__/api-stack.test.ts` (and the bundle/cognito stack tests) fail with `PathNotUnderRoot: entryPath (.../apps/api/src/lambda.ts) should be under projectRoot (.../packages/infra)` when synthesising the `NodejsFunction`. This reproduces on a clean `main` checkout locally but CI's Test job is green, so it's a local-only quirk (likely `aws-cdk-lib`'s `NodejsFunction` project-root auto-detection picking `packages/infra` as the root when run via vitest with cwd = `packages/infra`). Needs its own investigation — pass an explicit `projectRoot` / `depsLockFilePath` to the `NodejsFunction` in `api-stack.ts` so the tests don't depend on cwd. **This is the remaining blocker for a clean local `git push`.**

## Original problem statement

The repo's pre-push hook runs `turbo run typecheck test`, which on a stale or worktree checkout consistently failed. Root causes turned out to be (in order of impact): stale local `node_modules`, stale generated Prisma client, the eager `new PrismaClient()` in `db.ts`, and the `@pegasus/infra` cwd-sensitivity above.

## Why this matters

Every one of the seven longhaul-port PRs (#97–#103) ended up pushed with `git push --no-verify` because of this. That's a clear blast-radius problem:

- The hook is supposed to be the contract that protects main. Right now nobody can push without bypassing it, which means it protects nothing.
- When the hook is universally bypassed, real failures slip through. The team is one careless push away from a regression that the hook would have caught if it ran.
- New contributors hit this wall on day one. Either they figure out it's expected to bypass (corrosive habit), or they spend hours debugging an unrelated stack.

## Remaining work

### 1. Fix the `@pegasus/infra` `PathNotUnderRoot` failure (the actual blocker)

`packages/infra/lib/stacks/api-stack.ts:143` constructs `new nodejs.NodejsFunction(this, 'ApiFunction', { entry: path.join(__dirname, '../../../../apps/api/src/lambda.ts'), ... })` with no explicit `projectRoot` / `depsLockFilePath`. Newer `aws-cdk-lib` auto-detects the project root in a way that, when the tests run under vitest with cwd = `packages/infra`, resolves to `packages/infra` — and then rejects the `apps/api/...` entry as "not under root". CI happens not to hit it (different cwd / build ordering), but it breaks every local `turbo run test`.

Fix: pass an explicit `projectRoot` (or `depsLockFilePath: path.join(__dirname, '../../../../package-lock.json')`) to the `NodejsFunction` so root resolution is deterministic and cwd-independent. Re-run `packages/infra` tests locally to confirm.

### 2. Audit remaining `apps/api` DB tests for clean skips (lower priority now)

With the lazy `db.ts` in place, importing handlers no longer throws. The repository integration tests under `apps/api/src/repositories/__tests__/` mostly already wrap themselves in `describe.skipIf(!process.env['DATABASE_URL'])`. A few handler tests are still "unguarded" but they mock the repos so they don't actually touch the DB — leave them. If any test is found that *does* hit the DB without a guard, wrap it:
```ts
const hasDb = !!process.env['DATABASE_URL']
describe.skipIf(!hasDb)('...', () => { ... })
```

### 3. (Optional) Make the hook clearly tiered

Consider tightening the pre-push hook to the fast layers (typecheck + lint + unit tests) and leaving DB-backed + CDK-synth tests to CI only. That way the hook is something developers actually let run. Not required if items 1–2 land — at that point the full suite passes locally.

## Acceptance criteria

- `git push` on a clean checkout (no Docker, no `DATABASE_URL`) passes the pre-push hook without `--no-verify`.
- CI continues to run all layers (including DB-backed tests) against a real Postgres so coverage isn't lost.
- A clean re-run on `main` after these fixes confirms nothing slipped through during the `--no-verify` window (#97–#104).

## Out of scope

- Migrating `apps/api` off Prisma or onto a different schema.
- Reorganising the turbo pipeline beyond reclassifying test scopes.

## Done so far (this branch)

- `apps/api/src/db.ts` → lazy Proxy. `import { db }` no longer requires `DATABASE_URL`; client created on first property access; functions bound to the real client so `$transaction` / `$extends` / `$disconnect` keep working.
- Verified: `apps/api` full suite 996/996 pass; `tsc --noEmit` clean (after `prisma generate`).
