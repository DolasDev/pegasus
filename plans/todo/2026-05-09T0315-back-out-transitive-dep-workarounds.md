# Back out transitive-dep workarounds once upstream catches up

## Context

The 2026-05-09 deploy session closed three high-severity advisories
(`@babel/plugin-transform-modules-systemjs`, `fast-uri`, `fast-xml-builder`)
via `overrides` in root `package.json`, swapped the CI audit gate from
`npm audit` to `audit-ci`, and pinned `jest-runtime` to `30.3.0` to
dodge an upstream regression. Two of those workarounds are temporary —
they exist only because we can't reach a transitively-bundled or
unreleased version of an upstream package today. Once upstream ships
the right thing, the workaround is dead weight that adds noise to
audits and can mask the next regression.

This plan tracks both workarounds back out.

## Workaround 1 — `fast-uri` allowlist in `audit-ci.jsonc` — DONE 2026-05-28

The `fast-uri` allowlist no longer exists. `audit-ci.jsonc` now reads
`"allowlist": []`, and the root `overrides` carries `"fast-uri": ">=3.1.2"`
which is reachable through every non-bundled path. CI is green without
the GHSA exceptions. Nothing further to do for this workaround.

## Workaround 2 — `jest-runtime` pin in `overrides`

**Why it exists (original framing).** `jest-runtime` 30.4.x calls
`this._moduleMocker.clearMocksOnScope(...)` from `Runtime.resetModules`,
which didn't exist on `jest-mock` at the time the pin was added.

**Why it exists (current framing, 2026-05-29).** `jest-mock@30.4.1` _does_
expose `clearMocksOnScope`, so the originally-stated exit condition is
met. **But removing the pin still breaks all 20 mobile suites** — verified
in this session with a clean `rm -rf node_modules package-lock.json && npm
install` followed by `npm run -w @pegasus/mobile test`:

```
Test Suites: 20 failed, 20 total
TypeError: this._moduleMocker.clearMocksOnScope is not a function
  at Runtime.resetModules (node_modules/jest-runtime/build/index.js:3784:28)
```

Root cause is one level deeper than the original plan captured:

- `react-native@0.83.6` (pinned by Expo SDK 55, also via root `overrides`)
  depends on `jest-environment-node@29.7.0`, which depends on
  `jest-mock@29.7.0`.
- npm hoists that 29.7.0 copy to root `node_modules/jest-mock` (verified
  via `cat node_modules/jest-mock/package.json` → `"version": "29.7.0"`,
  978-line `build/index.js` vs the 756-line 30.4.1 build).
- `jest-runtime._moduleMocker = this._environment.moduleMocker`, and
  `_environment` is the react-native preset's `jest-environment-node@29.7.0`,
  whose `ModuleMocker` class has no `clearMocksOnScope` method.
- So `jest-runtime@30.4.x` calls a method that doesn't exist on the
  29.x mocker the preset hands it. Pinning runtime to 30.3.0 dodges the
  call entirely.

**Real exit condition.** Either of:

1. `react-native` ships a release whose jest preset uses
   `jest-environment-node@^30` (and the matching `jest-mock@^30`).
   Verify with `npm ls jest-environment-node jest-mock` after the bump —
   only 30.x entries should appear.
2. We add a coordinated set of root `overrides` forcing
   `jest-environment-node`, `@jest/environment`, `@jest/fake-timers`,
   and `jest-mock` to `^30.4.x` tree-wide. Risky: react-native's preset
   wires those packages together at a specific 29.x ABI; forcing 30.x
   may break the preset's own setup. Worth a follow-up spike but not a
   drive-by change.

Until either ships, **leave the pin in place**. The `invalid:` warnings
from `npm ls` (the parent jest packages declare `^30.4.x`) are expected
and documented inline in `package.json`.

**The change when the time comes.**

- [ ] Confirm one of the two exit paths above is genuinely available
      (re-run the mobile test suite without the pin in a throwaway
      branch first).
- [ ] Delete the `"jest-runtime": "30.3.0"` line from `overrides`
      and the matching `//overrides` comment.
- [ ] `rm -rf node_modules package-lock.json && npm install` (npm
      doesn't fully re-resolve transitive overrides on an existing
      lockfile — same behavior we hit when adding the pin).
- [ ] `npm run -w @pegasus/mobile test` — should pass without the
      `clearMocksOnScope` error.
- [ ] Re-check the broader test suite via `turbo run test` since the
      shared `jest-mock` version changes.

## Out of scope

- **Process gap on `da94c92`.** That commit added the persona-coverage
  e2e test but never validated it end-to-end against staging — the
  cascade of failures during this session (missing OIDC creds → missing
  IAM perm → missing tenant domain) all stemmed from that. Worth
  discussing in a retrospective, not a code plan.
- **CDK `aws-cdk-lib` bundling.** The pattern of bundling `ajv` /
  `fast-uri` is upstream's choice; we just live with it.
