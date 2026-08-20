# Collapse hono to one version so the hono/prisma dependabot PRs can go green

## Problem

Five dependabot PRs have been stuck for weeks — #601 and #530 (hono), #501
(@hono/node-server + prisma), #545 (prisma group), and the recreated #643 — and the
hono ones all fail Typecheck at the same line:

```
src/app.ts(163,18): error TS2769: No overload matches this call.
  Argument of type 'MiddlewareHandler<Env>' is not assignable to
  'H<AppEnv, "/docs", BlankInput, HandlerResponse<any>>'.
    Type 'unknown' is not assignable to type 'object | undefined'.
```

## Root cause — TWO copies of hono, not a code incompatibility

`apps/api` is the only workspace that declares `hono`. But **`@prisma/dev` hard-depends
on `hono: ^4.12.8`**. The moment dependabot moves `apps/api` to `^4.13.x`, npm keeps
4.12.25 hoisted at the root (to satisfy `@prisma/dev`) and nests 4.13.3 under
`apps/api`:

```
4.12.25 <- node_modules/hono            (for @prisma/dev)
4.13.3  <- apps/api/node_modules/hono   (for apps/api)
```

The `@hono/*` companions (`swagger-ui`, `zod-openapi`, `zod-validator`, `node-server`)
are hoisted at the root, so their peer `hono` resolves to **4.12.25**, while `app.ts`
imports `Hono` from **4.13.3**. Two distinct type identities for `Context`/`Env`, hence
the error. TypeScript says so outright once you read past the first lines:

```
Property '[GET_MATCH_RESULT]' is missing in type
  '.../apps/api/node_modules/hono/.../HonoRequest' but required in type
  '.../node_modules/hono/.../HonoRequest'
```

This is precisely the situation CLAUDE.md's dependency rule covers: do not let two
versions coexist — converge on one.

**This also explains the long-standing note that "the prisma PR needs the root hono
override."** Prisma is the reason the override was needed; it was removed at some
point, and the hono PRs have been unmergeable ever since.

## The fix

Add a root `overrides` entry pinning the whole tree to one hono line:

```json
"hono": ">=4.13.3 <5"
```

A range (not an exact pin) so future 4.x bumps do not re-block on the override.
`@prisma/dev`'s `^4.12.8` is satisfied by 4.13.3, so nothing regresses.

**GOTCHA:** editing `overrides` alone is NOT enough — npm caches the resolution and
`packages[""].overrides` in the lock stays `null`. The existing `#513` recipe applies:
delete the `*/node_modules/hono` keys from `package-lock.json`, then re-resolve. Verified.

## Verification (done before opening the PR)

Against PR #601's exact tree (`npm ci` from its lockfile):

| step                               | result                                     |
| ---------------------------------- | ------------------------------------------ |
| reproduce on the PR tree as-is     | FAILS at `app.ts:163` — matches CI exactly |
| add override, no lock-key delete   | still two copies; override ignored         |
| delete hono lock keys + re-resolve | **one** copy, 4.13.3                       |
| `tsc --noEmit` in `apps/api`       | **clean**                                  |
| `turbo typecheck` (all workspaces) | **14/14 successful**                       |

No source change is required — the earlier idea of casting at the `/docs` call site was
wrong, and a cast in fact makes it worse (TS2352, because the two `HonoRequest` types
genuinely do not overlap).

## Follow-on

Once this lands, rebase #601/#530/#545/#643; expect them to go green and (being
policy-approved minors/patches) auto-merge via the #633 `enqueue` job. Close #501 as
superseded — it is the oldest, overlaps both hono and prisma, and the policy gate never
approved it.
