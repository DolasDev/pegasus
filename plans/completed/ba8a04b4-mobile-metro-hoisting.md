# Mobile production bundle fails — expo-router babel transform not applied (monorepo hoisting)

## Context

The mobile CI/CD pipeline (shipped: `#432/#493/#495/#504/#506`) works end-to-end, but the
first real EAS builds revealed the `@pegasus/mobile` app **cannot produce a production JS
bundle** — on EAS _and_ locally (`npx expo export --platform android`), identical failure:

```
SyntaxError: node_modules/expo-router/_ctx.android.js:
Invalid call at line 2: process.env.EXPO_ROUTER_APP_ROOT
Android Bundling failed … expo-router/entry.js
```

This blocks every production Android build (and the eventual iOS one). It is **not** a CI
problem — it reproduces in a bare local export — so it must be fixed in the app's dependency
tree, independent of the pipeline.

## Root cause (confirmed empirically, not inferred)

`expo-router/_ctx.android.js` calls `require.context(process.env.EXPO_ROUTER_APP_ROOT, …)`.
The `EXPO_ROUTER_APP_ROOT` reference is supposed to be **inlined to a string literal** by
`babel-preset-expo`'s `expoRouterBabelPlugin` (`node_modules/babel-preset-expo/build/expo-router-plugin.js`).
Metro's `require.context` requires a static string first arg; without the inline it throws
"Invalid call".

That plugin is only added when this gate passes (`babel-preset-expo/build/index.js:180`):

```js
if (hasModule('expo-router')) {
  /* include expoRouterBabelPlugin */
}
```

`hasModule` (`common.js:29`) is just `require.resolve('expo-router')` **from babel-preset-expo's
own location**. And there's the monorepo hoisting bug:

- `babel-preset-expo` is **hoisted to the workspace root** (`node_modules/babel-preset-expo@55.0.22`).
- `expo-router` is **nested in the app** (`apps/mobile/node_modules/expo-router@55.0.17`) — it's
  the _only_ expo-\* dep that didn't hoist (expo-constants, expo-linking, expo-font, react-native
  all hoisted). Its tight peers (`@expo/log-box` pinned to exactly `55.0.13`,
  `react-server-dom-webpack` ranges) plus the split `babel-preset-expo` (55.0.22 vs 55.0.24)
  block it from hoisting.
- So `require.resolve('expo-router')` from the root `babel-preset-expo` **fails** → the gate is
  false → the inline plugin is silently skipped → the bundle breaks.

**Proof:** symlinking `node_modules/expo-router → apps/mobile/node_modules/expo-router` (so the
root `babel-preset-expo` can resolve it), clearing caches, and re-running
`npx expo export --platform android` → **`android bundles (1): Exported`** (success). Symlink
then removed; tree restored. Ruled out as _not_ the cause: `babel.config.js` (tested standard
single-preset config, cache cleared), `metro.config.js` (tested default), setting
`EXPO_ROUTER_APP_ROOT` manually (the gate, not the env value, is the problem), and app-config
resolution (`expo config` resolves fine, expo-router detected as a plugin).

## Goal

Make `expo-router` resolvable from the `babel-preset-expo` that the app's babel config loads,
so the `expoRouterBabelPlugin` runs and the production bundle builds — without fighting npm
hoisting (per repo CLAUDE.md: prefer one consistent version over hoisting hacks).

## Chosen approach — Option A (locked)

**Collapse the duplicate packages that force `expo-router` to nest, via root `package.json`
`overrides`, so npm hoists `expo-router` to the root where `babel-preset-expo` resolves it.**
This is the repo's "one consistent version" path — no nested `node_modules`, copies, or
hoisting hacks (CLAUDE.md). Option B (below) is only a documented fallback if A can't hoist it.

The authoritative verification loop is **local and ~5s**:
`cd apps/mobile && npx expo export --platform android` — fails today with "Invalid call",
prints `android bundles (1): Exported` when fixed. Re-run it after each `npm install`.

### Execution steps (in the worktree `pegasus-mobile-metro-hoisting`)

1. **Baseline the failure** (confirm the repro before changing anything):

   ```
   cd apps/mobile && rm -rf .expo node_modules/.cache
   npx expo export --platform android --clear        # expect: Invalid call … EXPO_ROUTER_APP_ROOT
   cd ../..
   npm ls expo-router                                 # expect: nested at apps/mobile/node_modules
   npm ls babel-preset-expo                            # expect: two copies 55.0.22 + 55.0.24
   ```

2. **Add the override** to the **root** `package.json`. In `"overrides"` add:

   ```json
   "babel-preset-expo": "55.0.24"
   ```

   and a matching line in the `overrides` `notes` object (convention in this repo — every
   override carries a note), e.g.:

   ```
   "babel-preset-expo": "Monorepo hoisting: expo@55.0.28 wants babel-preset-expo 55.0.24 but
   apps/mobile devDep ^55.0.15 resolved 55.0.22, so two copies hoisted. babel-preset-expo gates
   its expo-router inline plugin on require.resolve('expo-router') from its own dir; the split +
   expo-router being the only un-hoisted expo-* dep meant the root copy couldn't see expo-router
   and skipped the EXPO_ROUTER_APP_ROOT inline → production bundle 'Invalid call'. Pin one version
   so expo-router hoists to root and resolves. Remove once expo/app align on one babel-preset-expo."
   ```

3. **Reinstall + re-verify hoisting:**

   ```
   npm install
   npm ls babel-preset-expo     # expect: single 55.0.24
   npm ls expo-router           # want: resolved at ROOT node_modules
   node -e "console.log(require.resolve('expo-router/package.json',{paths:['./node_modules/babel-preset-expo']}))"
   # want: prints a path (no MODULE_NOT_FOUND)
   ```

4. **If `expo-router` still nests** after step 3, add the peer that blocks it (expo-doctor flags
   it duplicated) to `overrides` + notes, reinstall, re-check step 3:

   ```json
   "@expo/log-box": "55.0.13"
   ```

   (and if still nested, `"@expo/metro-runtime": "~55.0.12"`).

5. **Prove the bundle builds** (the milestone):

   ```
   cd apps/mobile && rm -rf .expo node_modules/.cache
   npx expo export --platform android --clear        # MUST print: android bundles (1): Exported
   cd ../..
   ```

6. **Align the app devDep (optional tidy):** if step 2's override is in, bump
   `apps/mobile/package.json` devDep `babel-preset-expo` `^55.0.15` → `55.0.24` so the declared
   and resolved versions match and no future install re-splits it.

7. **Guard the lockfile diff:** `git diff --stat package-lock.json` — expect a **scoped** change
   in the expo/metro/babel subtree. If `npm install` rewrote the whole lock (100s of unrelated
   packages), reset and use the surgical/targeted lock approach (delete only the affected
   `node_modules/*` lock keys + `npm install --package-lock-only`), as done for the audit-ci fix.

### Fallback — Option B (only if A cannot hoist expo-router)

Declare `expo-router: "~55.0.17"` (and if needed `@expo/metro-runtime: "~55.0.12"`) in the
**root** `package.json` `dependencies`. A root-level declaration forces a single hoisted copy —
guaranteed by the symlink proof — at the cost of a mobile dep living at the workspace root.

### Not part of the fix (note only)

- `apps/mobile/babel.config.js` has a redundant second preset `@babel/preset-typescript`
  (babel-preset-expo already handles TS). Tested — **not** the cause. Optional cleanup, out of scope.

## Files

- `package.json` (root) — add `overrides["babel-preset-expo"]` (+ `@expo/log-box` if step 4) and
  matching `notes` entries.
- `package-lock.json` — updated by `npm install`; keep the diff scoped (step 7).
- `apps/mobile/package.json` — optional devDep alignment (step 6).
- `plans/in-progress/mobile-metro-hoisting.md` — this plan, committed with the fix (moved to
  `plans/completed/` at `/workstream-finish`).

## Verification

1. **Local bundle (fast loop, authoritative):** step 5 prints `android bundles (1): Exported`,
   no "Invalid call".
2. **Resolution check:** `npm ls expo-router` → single copy at **root**; `npm ls babel-preset-expo`
   → single `55.0.24`; the `require.resolve(... paths:[babel-preset-expo])` in step 3 succeeds.
3. **CI unaffected:** from the worktree, `npm run typecheck` green; `apps/mobile` jest green
   (`node node_modules/.bin/turbo run test --filter=@pegasus/mobile`); `cd apps/mobile &&
npx expo install --check` and `npx expo-doctor` no worse than before (ideally the
   duplicate-`@expo/log-box` warning clears). Note: expo-doctor's duplicate-deps check is
   tolerated in CI (`ci.yml` greps it out) — don't let a _new_ failure slip in.
4. **Real build (final, after merge):** dispatch `mobile-release` with `platform=android`,
   `submit=false` → watch the EAS build reach **FINISHED** (produces an AAB) on the dashboard
   (`expo.dev/accounts/dolas.dev/projects/moving-storage-driver/builds`). The blocked milestone.
5. **iOS:** once Android is green, dispatch `platform=ios` (simulator) — same bundle step, should
   clear too (its earlier EAS error was the Node-20 issue, fixed by #504).

## Outcome (executed)

Option A worked, but **required both overrides** (step 2 alone was insufficient):

- `"babel-preset-expo": "55.0.24"` collapsed the two copies to one, **but expo-router still
  nested** — its exact peer `@expo/log-box@55.0.13` couldn't dedupe because of a circular peer
  (`@expo/log-box` → `@expo/dom-webview` → `expo` → `@expo/log-box`), which kept expo-router in
  `apps/mobile/node_modules`.
- Adding `"@expo/log-box": "55.0.13"` (plan step 4) collapsed the circular copies → **expo-router
  hoisted to root** → resolve gate passes.
- npm would not re-evaluate the new overrides against the already-"valid" lockfile (`npm install`
  reported no lock change). Forced re-resolution by surgically deleting only the affected
  `packages` keys from `package-lock.json` (expo-router / @expo/log-box / @expo/metro-runtime /
  @expo/dom-webview / babel-preset-expo) then `npm install` — the scoped-lock approach from step 7.

Results — all green:

- `npx expo export --platform android` → `android bundles (1): Exported` (was "Invalid call").
- `npm ls`: single `expo-router@55.0.17` at root, single `babel-preset-expo@55.0.24`; the
  `require.resolve('expo-router', {paths:[.../babel-preset-expo]})` gate resolves.
- `npm run typecheck` green; `@pegasus/mobile` jest 22 suites / 190 tests green;
  `expo install --check` up to date; **`expo-doctor` 19/19** (the duplicate-`@expo/log-box`
  warning cleared).
- Lockfile diff scoped to the expo/metro/babel/react-native subtree (net −207 lines from
  collapsing nested duplicates); no whole-lock rewrite.
- Step 6 tidy applied: `apps/mobile` devDep `babel-preset-expo` `^55.0.15` → `55.0.24`.

## Landing

Commit the plan + fix together; open one PR; land via the merge queue
(`/workstream-finish`, or `gh pr create` → `gh pr merge --auto`). No infra deploy — this touches
only `package.json`/lockfile in the mobile/babel subtree (not `packages/infra` or `forceAllPaths`),
so it won't trigger `deploy.yml`.
