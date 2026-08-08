# Put `apps/mobile` under the typecheck and lint gates

**Branch:** `chore/mobile-typecheck-lint`
**Goal:** `turbo run typecheck` and `turbo run lint` cover `apps/mobile`, and both
are green — so a type error or lint violation in the driver app fails CI like it
does in every other workspace.

---

## Why

`apps/mobile/package.json` has no `typecheck` or `lint` script, so Turbo skips it
entirely. CI gates the driver app on `jest` alone. Every sibling workspace
(`apps/api`, `apps/tenant-web`, `packages/domain`) declares
`"typecheck": "tsc --noEmit"` and `"lint": "eslint src"`.

`.github/workflows/ci.yml:138` runs `turbo run typecheck --continue` and `:178`
runs `turbo run lint`, so adding the two scripts wires mobile into the existing
gate with no workflow change.

This gap was recorded but not closed at #546, with the stopgap note "typecheck
source only". This closes it properly.

## Current state (measured on `main` @ 44ebdab6)

- `npx tsc --noEmit -p apps/mobile/tsconfig.json` → **fails**, ~262KB of errors.
- Every error observed so far is in a **test** file, and the bulk are missing jest
  globals (`Cannot find name 'describe' / 'it' / 'expect'`), plus stale typing
  patterns (`Cannot use namespace 'jest' as a value`, `Namespace 'global.jest' has
no exported member 'Mock'`).
- `@types/jest@^30` IS in `apps/mobile` devDependencies and resolves to
  `<root>/node_modules/@types/jest` with the right global `declare var`s — so
  automatic `@types` inclusion is not reaching the root for this tsconfig.
- `apps/mobile/tsconfig.json` is 4 lines: extends `expo/tsconfig.base`, `strict: true`.
- `eslint` over the mobile files touched by #605 was already clean, and lint-staged
  runs `eslint --fix` on every committed mobile `*.{ts,tsx}`, so lint should be
  near-clean.

## Plan

- [x] **1. Add the scripts** to `apps/mobile/package.json`, matching the sibling
      convention: `"typecheck": "tsc --noEmit"` and `"lint": "eslint src app"`
      (mobile has both a `src/` and an expo-router `app/` directory).
- [x] **2. Make jest globals resolve.** Try in order, stopping at the first that works: 1. `"types": ["jest"]` in `apps/mobile/tsconfig.json` compilerOptions. 2. If that yields "Cannot find type definition file for 'jest'", add
      `typeRoots` covering both `${configDir}/node_modules/@types` and the repo
      root's `${configDir}/../../node_modules/@types`. 3. Fallback with no blast radius: a project `d.ts` with
      `/// <reference types="jest" />`, which pulls jest in without disabling
      auto-inclusion.
      **Watch for collateral:** an explicit `types` array turns OFF auto-inclusion of
      every other global `@types` package. Source typechecks clean today _under
      auto-inclusion_ — re-run after the change and, if `process` or other globals
      break, extend the array (`"node"`) rather than reverting.
- [x] **3. Fix the residual real errors** in test files (stale `jest.Mock`-as-a-type
      patterns and similar). This is the actual work; the globals fix only unmasks it.
- [x] **4. Lint clean.** Run `eslint src app` and fix what it reports.
- [x] **5. Verify the gate actually engages:** `turbo run typecheck` and
      `turbo run lint` from the repo root must now list `@pegasus/mobile` among the
      executed tasks, and both must pass.
- [x] **6. Full gates:** root `npm run typecheck`, `npm run lint`, `npm test`.

## Explicitly out of scope / must NOT do

- **Do not exclude `__tests__` (or any test glob) from the tsconfig to make this
  pass.** babel-jest strips types without checking them, so an excluded test file is
  typechecked nowhere — and a silently-neutered `@ts-expect-error` is exactly the
  trap this repo has already been bitten by. If a test file has a real type error,
  fix the test.
- No change to `expo/tsconfig.base` behavior beyond what step 2 needs.
- No new CI workflow or job — the scripts are the whole wiring.

## Follow-on (separate from the code change)

Once merged to `main`, cut an Android release to the **Closed testing (`alpha`)**
track:
`gh workflow run mobile-release.yml --ref main -f env=prod -f platform=android -f submit=true`

- Must dispatch from `main` — the `prod` GitHub Environment is branch-protected, and
  a feature-branch dispatch fails with "not allowed to deploy to prod".
- `eas.json` `submit.production.android.track` = `alpha`, which IS Closed testing;
  `autoIncrement: true` handles the version code.
- A green workflow run only means the build was **accepted**. Get the Build ID and
  Submission ID from the run log and poll EAS GraphQL with the `~/.expo/state.json`
  session secret — local `eas build:view` is broken in this hoisted monorepo. Done
  means build FINISHED **and** submission FINISHED.
- Promotion from closed testing to Production stays manual in the Play Console.

## Outcome

Both gates now cover `apps/mobile` and both are green. `turbo run typecheck` went
from 13 to **14 tasks**, `turbo run lint` from 8 to **9** — `@pegasus/mobile` is in
both. Root `npm test`: 15/15 tasks, mobile 185/185.

**Step 2 resolved at the first rung.** `"types": ["jest", "node"]` in
`apps/mobile/tsconfig.json` fixed the whole flood — thousands of phantom errors down
to 8 real ones. `"node"` was included pre-emptively alongside `"jest"` because an
explicit `types` array disables auto-inclusion of every other global `@types`
package; source stayed clean after the change, so no further entries were needed.

**The 8 real errors were genuine drift, not noise** — exactly why the gap was worth
closing:

1. `Session` gained `tenantName` and `roleNames` (see `packages/auth/src/session.ts`)
   and five test fixtures across `authService.test.ts` / `AuthContext.test.tsx` were
   never updated. Fixtures filled in.
2. `AuthContext.test.tsx`'s `AppState.addEventListener` mock typed its handler as
   `(state: string) => void` instead of `(state: AppStateStatus) => void`.
3. `logger.test.ts` carried an `eslint-disable` for `@typescript-eslint/no-var-requires`,
   a rule since **renamed** to `no-require-imports` — so the directive had silently
   stopped applying and the lint error underneath it was live. Directive corrected;
   the `require()` itself is deliberate (it re-evaluates the module after
   `jest.resetModules()`, which a hoisted static import cannot do) and was kept.

**One detour worth recording.** The `oauthService.test.ts` error (`'"cancel"' is not
assignable to '"success" | WebBrowserResultType'`) was first "fixed" by switching to
the real enum member `WebBrowser.WebBrowserResultType.CANCEL`. That typechecked and
**broke the test at runtime** — `expo-web-browser` is fully jest-mocked, so the enum
object does not exist. Passing the real enum through the mock via `jest.requireActual`
then failed to parse under the RN transform. Final fix: type the test helper's
`browserResult` as the shape the **mock** actually produces (`{ type: string; url?: string }`),
which is honest — the code under test only ever does `result.type !== 'success'`.
Lesson: a typecheck-only fix in a test file must still be run under jest.

Test files were **not** excluded from the tsconfig — see the out-of-scope note above.
