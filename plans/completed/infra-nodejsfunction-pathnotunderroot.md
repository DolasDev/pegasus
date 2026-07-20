# Plan: Fix `@pegasus/infra` `PathNotUnderRoot` test failures

> **CLOSED 2026-05-12 — could not reproduce.** On a clean `main` (HEAD `b08726b`), `cd packages/infra && node ../../node_modules/.bin/vitest run` → 10 files / 203 tests pass; `node node_modules/.bin/turbo run test --filter=@pegasus/infra` → pass (both Lambdas bundle fine). Traced `aws-cdk-lib@2.253.1`'s `NodejsFunction`: `depsLockFilePath = findUpMultiple([...lockfiles], process.cwd())`, then `projectRoot = path.dirname(depsLockFilePath)`; `Bundling` throws `PathNotUnderRoot` only if `path.relative(projectRoot, entry)` contains `..`. With `process.cwd()` = `packages/infra` and **no** lockfile under `packages/infra/`, the walk lands on the repo-root `package-lock.json`, so `projectRoot` = repo root and `apps/api/src/lambda.ts` resolves cleanly. The only way to hit `PathNotUnderRoot` here is a stray lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lock*`) inside `packages/infra/` at run time — i.e. transient local cruft, **not a code bug** (same class as the two sibling items `aa5674c` reclassified in `longhaul-prepush-database-url.md`). The "preferring `path.dirname(entry)`'s nearest package root" hypothesis below is **wrong** for 2.253.1 — it walks from `process.cwd()` only.
>
> Not actioned: optional hardening (explicit `depsLockFilePath` on all 9 `NodejsFunction` constructs in `packages/infra/lib/stacks/*`) would make root resolution cwd-independent, but churns the infra snapshot / byte-level tests (`api-stack.bundle.test.ts`, AVP/Cognito IAM pins) — do it deliberately as its own PR if wanted, not reactively. Everything below is the original (now-superseded) investigation plan, kept for context.

---

**Branch:** main (no code written yet — this is an investigation+proposal plan; implement on a feature branch)
**Goal:** Make `node node_modules/.bin/turbo run test` pass locally for `@pegasus/infra` so a clean `git push` doesn't require `--no-verify`. Currently 5 of 10 infra test files fail with `PathNotUnderRoot` while CI is green.

> This plan was written after the longhaul-port remediation sweep (see `plans/todo/longhaul-prepush-database-url.md`). That doc tracks the broader "pre-push hook fails locally" item; this plan is item 1 from it — the remaining blocker.

## Status

- [ ] 1. Re-investigate the root cause (steps in "Re-investigation" below)
- [ ] 2. Confirm whether CI is genuinely unaffected or just masking it
- [ ] 3. Pick a fix from "Candidate solutions" (pending findings)
- [ ] 4. Implement on a feature branch, re-run `turbo run test` for `@pegasus/infra` locally + push to confirm CI stays green
- [ ] 5. Update `plans/todo/longhaul-prepush-database-url.md` and archive this plan

## Symptom (verified 2026-05-12, clean `main` checkout, local WSL2)

`cd packages/infra && node ../../node_modules/.bin/vitest run` fails:

```
FAIL  lib/stacks/__tests__/api-stack.test.ts        (47 tests | 47 failed)
FAIL  lib/stacks/__tests__/api-stack.bundle.test.ts
FAIL  lib/stacks/__tests__/cognito-stack.test.ts
... Test Files  5 failed | 5 passed (10)
    Tests  86 failed | 51 passed | 66 skipped (203)
```

Every failure is the same error, thrown during stack synthesis:

```
PathNotUnderRoot: entryPath (/home/steve/repos/pegasus/apps/api/src/lambda.ts)
  should be under projectRoot (/home/steve/repos/pegasus/packages/infra)
 ❯ new ApiStack lib/stacks/api-stack.ts:143:25
    143|     const apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
```

The construct at `packages/infra/lib/stacks/api-stack.ts:143`:

```ts
const apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  entry: path.join(__dirname, '../../../../apps/api/src/lambda.ts'),
  handler: 'handler',
  environment: {
    /* ... */
  },
  // no `projectRoot`, no `depsLockFilePath`, no `bundling.commandHooks` etc.
})
```

`__dirname` here is `packages/infra/lib/stacks/`, so `entry` resolves correctly to `<repo>/apps/api/src/lambda.ts`. The problem is `projectRoot` resolving to `packages/infra` instead of the repo root — `aws-cdk-lib`'s `NodejsFunction` then rejects an entry that lives outside it. (MEMORY.md notes this same relative path as the intended one — the entry isn't wrong; the project-root inference is.)

## What I checked and ruled out

- **It's not my changes.** Reproduces on a clean `main` checkout — verified by `git stash` round-trip while the lazy-`db.ts` work was in flight.
- **It's not a `package-lock.json` change.** `npm install` (run during the sweep to materialise stale deps) did not modify the lockfile. `aws-cdk-lib@2.253.1` is what the lockfile pins and what's installed; `packages/infra/package.json` requires `^2.250.0`.
- **There is no `package-lock.json` (or `package.json` resolvable as a project root) inside `packages/infra/`** — checked; only the repo-root lockfile exists.
- **`turbo run test` in CI does include `@pegasus/infra`** (the `test` task isn't filtered; CI's Test step is `turbo run test`), yet the Test job is GREEN on every recent merged PR (#97–#106). So CI genuinely isn't hitting this — it's not just that CI doesn't run these tests.
- **Other infra stack tests pass** (5 of 10 files) — only the ones that synthesise `ApiStack`/the bundle/`CognitoStack` fail, i.e. only the ones that construct a `NodejsFunction`.

## Best current hypothesis

`aws-cdk-lib`'s `NodejsFunction` auto-detects `projectRoot` (when `projectRoot`/`depsLockFilePath` aren't given) by walking up from some base looking for a lock file. Locally — vitest running the TS sources with `process.cwd()` = `packages/infra` — that walk lands on `packages/infra` (or, more likely, a recent `aws-cdk-lib` started preferring `path.dirname(entry)`'s nearest package root, which is `apps/api`, then intersecting with cwd's package root `packages/infra` and erroring because they're disjoint). In CI the resolution happens to pick the repo root — possibly because of a different cwd, the absence of stale local `cdk.out`/build artifacts, or a different `node_modules` layout after `npm ci`. **Net:** the construct is relying on implicit project-root inference that is environment-sensitive, and the fix is to make it explicit. But the _exact_ mechanism (and therefore the cleanest fix) needs the re-investigation below — don't just slap `depsLockFilePath` on it and hope.

## Re-investigation (do this first)

1. **Capture the actual resolved values.** Temporarily add, just above line 143 in `api-stack.ts` (or in a throwaway test):
   ```ts
   console.log(
     'cwd',
     process.cwd(),
     '__dirname',
     __dirname,
     'entry',
     path.join(__dirname, '../../../../apps/api/src/lambda.ts'),
   )
   ```
   Run the failing test locally and in a CI run (push a debug branch). Compare. This pins down whether cwd, `__dirname`, or entry differ between the two.
2. **Read the `aws-cdk-lib@2.253.x` `NodejsFunction` source** for how `projectRoot` / `depsLockFilePath` are resolved when not supplied — `node_modules/aws-cdk-lib/aws-lambda-nodejs/lib/function.js` and `bundling.js` (look for `findLockFile`, `findUp`, `PathNotUnderRoot`). Diff against the version that was installed _before_ the sweep's `npm install` (check `git log -p package-lock.json` for the last `aws-cdk-lib` bump) — there may be a behavior change in project-root inference. `git log --oneline -- packages/infra/lib/stacks/api-stack.ts packages/infra/lib/stacks/__tests__/api-stack.test.ts` shows the last touches were `4906d76` / `28292d9` / `cf36796`; check whether those passed CI at the time (they did) and what `aws-cdk-lib` was pinned to then.
3. **Test the "stale local artifacts" theory.** `git clean -ndx packages/infra apps/api` (dry run) to see what untracked stuff is around (`cdk.out/`, `dist/`, `cdk.context.json`). Try the failing test after removing `apps/api/dist/` and `packages/infra/cdk.out/`. If it then passes, the fix is partly a `.gitignore`/clean-state issue, not (only) a construct change.
4. **Confirm the CI cwd.** Check `.github/workflows/ci.yml` Test step — it's `node node_modules/.bin/turbo run test` with no `working-directory`, so turbo runs each package task from that package's dir, same as local. If cwd is the same, the difference must be filesystem state (artifacts) or `node_modules` layout — narrow it down.

## Candidate solutions (pick after re-investigation)

- **A. Make project root explicit on the `NodejsFunction` (preferred if the inference is just ambiguous).** Add `depsLockFilePath: path.join(__dirname, '../../../../package-lock.json')` (and/or `projectRoot: path.join(__dirname, '../../../..')`) to the `ApiStack` `NodejsFunction` props, plus the same to any other `NodejsFunction` in the repo (grep `new nodejs.NodejsFunction` / `new NodejsFunction` under `packages/infra/`). Re-run the infra suite locally; push to confirm CI stays green. Lowest blast radius.
- **B. Set the vitest cwd / `root` for `@pegasus/infra`** so synthesis always happens with `process.cwd()` = repo root (e.g. `test: { root: '../..' }` or a `process.chdir` in a setup file). Riskier — changes test harness behavior globally for the package.
- **C. Pin `aws-cdk-lib` back to the last version that didn't have this behavior** (only if step 2 shows a regression and A doesn't fully fix it). Least preferred — drags in whatever else changed.
- **D. `.gitignore` + a `pretest` clean** if step 3 shows stale `dist/`/`cdk.out/` is the trigger. Complementary to A, not a substitute.

Whichever is chosen: also re-run the **full** `turbo run test` locally afterwards to confirm nothing else is red, then push and confirm CI is still green (don't trust local-only verification for infra/CDK).

## Files likely in scope

| File                                                                       | Action                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/infra/lib/stacks/api-stack.ts`                                   | add explicit `depsLockFilePath`/`projectRoot` to the `ApiStack` `NodejsFunction` (solution A) |
| any other `packages/infra/lib/stacks/*.ts` constructing a `NodejsFunction` | same treatment (grep first)                                                                   |
| `packages/infra/vitest.config.ts`                                          | only if solution B is chosen                                                                  |
| `packages/infra/.gitignore` / `package.json`                               | only if solution D is chosen                                                                  |
| `plans/todo/longhaul-prepush-database-url.md`                              | update item 1 status when done                                                                |

## Risks / notes

- Changing `NodejsFunction` props can shift the synthesised CloudFormation template (asset hashes, `Code.S3Key`). The infra tests include byte-for-byte / snapshot assertions (`api-stack.bundle.test.ts`, the AVP/Cognito IAM pins). Expect to update snapshots; review the template diff to confirm only asset-path metadata changed, not actual resource config.
- Do not bypass: this is the "fix CI first" rule (CLAUDE.md) — but here CI is _passing_ and local is _failing_, so the urgency is "unblock local `git push`", not "stop the line". Still worth doing properly rather than left as a permanent `--no-verify` excuse.
- After this lands, do a clean `git push` from a fresh checkout (no Docker, no `DATABASE_URL`, after `npm ci`) to confirm the pre-push hook (`turbo run typecheck test`) passes end-to-end — that's the real acceptance test for the whole `longhaul-prepush-database-url.md` item.
