# Pre-push hook fails locally on tests that require `DATABASE_URL`

Captured 2026-05-11 during the longhaul-port audit-and-remediation sweep.

## Problem

The repo's pre-push hook runs `turbo run test`, which on a fresh worktree (no `DATABASE_URL` set, no Docker container up) consistently fails in three places:

1. **`@pegasus/api` integration tests** — many `apps/api/src/**` tests instantiate Prisma directly and bail out at load time with `Error: environment variable DATABASE_URL is not set`. CLAUDE.md says these "skip when DATABASE_URL unset," and most do — but ten test files in `apps/api` currently fail-loud rather than skip. Need to either gate at the file level (`describe.skipIf(!process.env['DATABASE_URL'])` wrapping the whole file) or move the bare `new PrismaClient()` calls behind a lazy accessor.

2. **`@pegasus/vpn-agent` tests** — fail with `Cannot find module '@aws-sdk/client-cloudwatch'`. The package's `package.json` is missing that dep. Either add it, or remove the import if vpn-agent doesn't actually use cloudwatch (worth checking — the file may be dead code).

3. **`@pegasus/users` repository tests** — mentioned by Unit 4's worker as a "prisma schema drift in users.repository" failure on clean `main`. Needs separate diagnosis.

## Why this matters

Every one of the seven longhaul-port PRs (#97–#103) ended up pushed with `git push --no-verify` because of this. That's a clear blast-radius problem:

- The hook is supposed to be the contract that protects main. Right now nobody can push without bypassing it, which means it protects nothing.
- When the hook is universally bypassed, real failures slip through. The team is one careless push away from a regression that the hook would have caught if it ran.
- New contributors hit this wall on day one. Either they figure out it's expected to bypass (corrosive habit), or they spend hours debugging an unrelated stack.

## Proposed fix

Two layers:

### Layer 1: make the failing tests skip cleanly without `DATABASE_URL`

- Audit `apps/api/src/**/*.test.ts` for any test file that imports a Prisma-using module at the top level and instantiates the client unconditionally. Convert each to:
  - File-level skip:
    ```ts
    const hasDb = !!process.env['DATABASE_URL']
    describe.skipIf(!hasDb)('...', () => { ... })
    ```
  - Or wrap the Prisma usage in a lazy factory that only runs inside the `beforeAll`.
- `apps/api/src/repositories/users.repository.ts` (or wherever Unit 4's "schema drift" failure originates) — diagnose; fix Prisma client init, or skip cleanly.
- `packages/vpn-agent/package.json` — add `@aws-sdk/client-cloudwatch` as a regular dependency (or drop the import if unused).

### Layer 2: make the hook clearly opt-in vs required

- Right now the hook runs the full suite on every push. Consider tightening it to:
  - The fast layers only (typecheck + lint + unit tests that don't need infra).
  - Move DB-backed and AWS-SDK-backed tests to CI-only.
- That way the hook is something developers actually let run, and CI catches the rest.

## Acceptance criteria

- `git push` on a clean worktree (no Docker, no `DATABASE_URL`) passes the pre-push hook without `--no-verify`.
- CI continues to run all layers (including DB-backed tests) against a real Postgres so coverage isn't lost.
- The seven recently-merged longhaul-port PRs (#97–#103) get a clean re-run on main to confirm nothing slipped through.

## Out of scope

- Migrating `apps/api` off Prisma or onto a different schema.
- Reorganising the turbo pipeline beyond reclassifying test scopes.
