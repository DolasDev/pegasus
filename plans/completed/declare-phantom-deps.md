# Declare two phantom dependencies that only work by accident of hoisting

## Problem

Two workspaces import packages they never declare, and get away with it only because a
_different_ workspace declares them and npm happens to hoist the copy to the root:

| workspace         | uses                                                                     | actually declared by                     |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| `apps/tenant-web` | `@testing-library/user-event` (`src/__tests__/sso-config-form.test.tsx`) | `apps/admin-web`                         |
| `packages/infra`  | `tsx` (`cdk.json` app + `deploy:ci`)                                     | `apps/api`, `apps/e2e`, `apps/vpn-agent` |

The moment npm's layout shifts, the root copy disappears and both break. That is exactly
what dependabot's minor-and-patch group PR (#646) triggers: bumping admin-web's
`@testing-library/user-event` 14.6.1 -> 14.6.5 makes npm nest it under
`apps/admin-web/node_modules/`, and tenant-web's typecheck dies with

```
src/__tests__/sso-config-form.test.tsx(12,23): error TS2307:
  Cannot find module '@testing-library/user-event'
```

Likewise the `tsx` bump nests it under the three declaring workspaces, root
`node_modules/.bin/tsx` disappears, and every `packages/infra` test that shells out to
`npx cdk ls --app "npx tsx bin/app.ts"` fails with `sh: 1: tsx: not found`.

**The `tsx` one is not test-only.** `packages/infra/cdk.json` sets
`"app": "npx tsx bin/app.ts"` and `deploy:ci` uses the same invocation, so a hoisting
change breaks real deploys, not just CI.

## Fix

Declare each dependency in the workspace that actually uses it. No overrides — unlike
the hono (#644) and prisma (#647) cases, nothing here needs a single shared version;
these are simply undeclared imports, and the honest fix is to declare them.

## Verification

Reproduced on #646's branch (`npm ci` from a regenerated lockfile):

| step                                | result                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| #646 as-is                          | `Cannot find module '@testing-library/user-event'`         |
| declare it in tenant-web            | typecheck+lint 23/23 pass; `tsx: not found` surfaces next  |
| declare `tsx` in packages/infra     | root `node_modules/.bin/tsx` restored; manifest tests pass |
| `packages/infra` full suite, serial | **14/14 files, 365/365 tests**                             |

NOTE: running the infra suite with file parallelism produced 4-6 failures whose
membership changed between runs and which all pass in isolation — resource contention on
the dev machine, NOT a regression. `--no-file-parallelism` is clean, and `main` is clean.
Do not "fix" those by editing snapshot expectations.

## Out of scope

#646 additionally ships a malformed lockfile from dependabot (`npm ci` reports aws-sdk
entries missing) which `npm install --package-lock-only` regenerates — that is
dependabot's problem, not this PR's. #646 still needs a working lock after this lands.
