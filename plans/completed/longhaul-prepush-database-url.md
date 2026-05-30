# Pre-push hook fails locally on tests that require `DATABASE_URL`

Captured 2026-05-11 during the longhaul-port audit-and-remediation sweep.
Updated 2026-05-12 with findings + the first fix (lazy Prisma client).
Updated 2026-05-12: the `@pegasus/infra` `PathNotUnderRoot` item closed — could not reproduce; was transient local cruft, not a code bug (see below).

## Status

- ✅ **Fixed: `@pegasus/api` handler tests failing at module load** — `apps/api/src/db.ts` now exports a lazy Proxy instead of eagerly calling `new PrismaClient()` at import time. Importing `./db` is now side-effect-free w.r.t. `DATABASE_URL`; the client is created on first _use_. Handler tests that mock the repos (quotes/users/events/orders/settings/api-clients/…) no longer collapse at collection when `DATABASE_URL` is unset. (PR: see below.)
- ✅ **Not a real bug: missing `@aws-sdk/*` / `@hono/swagger-ui` modules** — these _are_ declared in `apps/api/package.json` (and `@aws-sdk/client-cloudwatch` / `@aws-sdk/client-ec2` in `apps/vpn-agent/package.json`). The local `node_modules` was just stale; `npm install` (or `npm ci`) materialises them. Worker reports of "package.json missing the dep" were a misdiagnosis. CI (`npm ci`) was never affected.
- ✅ **Not a real bug: `users.repository` "Prisma schema drift"** — the _generated_ client under `node_modules/@prisma/client` was stale (missing `legacyWindowsUsername`, `roleNames`, `policyStoreId`). `cd apps/api && prisma generate` regenerates it; the schema itself is fine. CI runs `prisma generate` in the Test job, so it was never affected.
- ✅ **Closed (could not reproduce): `@pegasus/infra` `PathNotUnderRoot`** — on a clean `main` (HEAD `b08726b`) the infra suite passes (10 files / 203 tests) both via `cd packages/infra && vitest run` and `turbo run test --filter=@pegasus/infra`. `aws-cdk-lib@2.253.1`'s `NodejsFunction` resolves `depsLockFilePath` by walking up from `process.cwd()` (= `packages/infra`); with no lockfile under `packages/infra/` it lands on the repo-root `package-lock.json`, so `projectRoot` = repo root and `apps/api/src/lambda.ts` is under it — fine. `PathNotUnderRoot` only fires if a stray lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lock*`) exists _inside_ `packages/infra/` at run time — transient local cruft, not a code bug (same class as the `@aws-sdk/*` and `users.repository` items above). Investigation plan archived to `plans/completed/infra-nodejsfunction-pathnotunderroot.md`. Optional hardening — explicit `depsLockFilePath` on the 9 `NodejsFunction` constructs in `packages/infra/lib/stacks/*` — left undone (churns the infra snapshot/byte-level tests; do it as its own PR if wanted, not reactively).

## Original problem statement

The repo's pre-push hook runs `turbo run typecheck test`, which on a stale or worktree checkout consistently failed. Root causes turned out to be (in order of impact): stale local `node_modules`, stale generated Prisma client, the eager `new PrismaClient()` in `db.ts`, and (a one-off, not a code bug) a stray lockfile under `packages/infra/` tripping CDK's `NodejsFunction` project-root resolution.

## Why this matters

Every one of the seven longhaul-port PRs (#97–#103) ended up pushed with `git push --no-verify` because of this. That's a clear blast-radius problem:

- The hook is supposed to be the contract that protects main. Right now nobody can push without bypassing it, which means it protects nothing.
- When the hook is universally bypassed, real failures slip through. The team is one careless push away from a regression that the hook would have caught if it ran.
- New contributors hit this wall on day one. Either they figure out it's expected to bypass (corrosive habit), or they spend hours debugging an unrelated stack.

## Remaining work

### 1. ~~Fix the `@pegasus/infra` `PathNotUnderRoot` failure~~ — CLOSED (could not reproduce; transient local cruft, see Status above)

Optional follow-up only: pass an explicit `depsLockFilePath: path.join(__dirname, '../../../../package-lock.json')` to the 9 `NodejsFunction` constructs in `packages/infra/lib/stacks/*` so root resolution is cwd-independent regardless of stray files. Will churn the infra snapshot / byte-level tests (`api-stack.bundle.test.ts`, AVP/Cognito IAM pins) — re-baseline and review the template diff. Do it as its own PR if the team wants the determinism; not a blocker.

### 2. Audit remaining `apps/api` DB tests for clean skips (lower priority now)

With the lazy `db.ts` in place, importing handlers no longer throws. The repository integration tests under `apps/api/src/repositories/__tests__/` mostly already wrap themselves in `describe.skipIf(!process.env['DATABASE_URL'])`. A few handler tests are still "unguarded" but they mock the repos so they don't actually touch the DB — leave them. If any test is found that _does_ hit the DB without a guard, wrap it:

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
