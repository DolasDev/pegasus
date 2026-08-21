# Hoist prisma so the prisma dependabot PRs can land

## Problem

#545 (prisma group) and #501 (@hono/node-server + prisma) fail CI with:

```
Error: Cannot find module '/home/runner/work/pegasus/pegasus/node_modules/.bin/prisma'
```

`@dependabot rebase` and `@dependabot recreate` both leave it failing — this is not
staleness, and regenerating dependabot's lockfile alone does not fix it (though that
regeneration IS also needed: dependabot's lock carried 398 lines of junk that
`npm install --package-lock-only` strips).

## Root cause — nested prisma, no root bin

`apps/api` and `apps/e2e` both declare **the same** `@prisma/client ^7.9.1`. npm still
refuses to hoist it and installs a private copy in each workspace:

```
7.9.1 <- apps/api/node_modules/@prisma/client
7.9.1 <- apps/api/node_modules/prisma
7.9.1 <- apps/e2e/node_modules/@prisma/client
```

With nothing at the root, `node_modules/.bin/prisma` never gets created — and that is
the path the build invokes. On `main` (prisma ^7.0.0) it happens to hoist, so the bin
exists and everything works; the moment dependabot bumps it, the layout flips.

This is the same hoisting quirk this repo already documents for `babel-preset-expo` and
`@expo/log-box`, and the remedy is the one already established there: **pin one version
so it hoists to root.** It is also the same shape as the hono/`@prisma/dev` collision
fixed in #644 — two copies where there must be one.

## The fix

Root `overrides` for `prisma` and `@prisma/client`, plus bump `apps/api` and `apps/e2e`
to match, so the manifests and the resolved tree agree. Ranges, not pins, so routine 7.x
bumps do not re-block on these entries.

**GOTCHA (same as #513 / #644):** editing `overrides` alone does nothing — npm caches
the old resolution. The `*/node_modules/prisma` and `*/node_modules/@prisma/client` keys
must be deleted from `package-lock.json` before re-resolving.

## Verification (done on PR #545's branch before opening this)

| step                                        | result                                        |
| ------------------------------------------- | --------------------------------------------- |
| #545 branch as-is                           | `.bin/prisma` absent; Typecheck/Test/E2E fail |
| regenerate lock only                        | strips 398 junk lines; bin STILL absent       |
| add overrides + drop lock keys + re-resolve | `node_modules/.bin/prisma` present at root    |
| `turbo typecheck lint test`                 | **38/38 successful**                          |

## Follow-on

Rebase #545, #387 and #646 after this lands. Close #501 as superseded — it is the oldest,
overlaps both hono and prisma, and the policy gate never approved it.
