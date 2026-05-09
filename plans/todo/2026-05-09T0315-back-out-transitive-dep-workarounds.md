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

## Workaround 1 — `fast-uri` allowlist in `audit-ci.jsonc`

**Why it exists.** `aws-cdk-lib` ships its dependencies as
`bundleDependencies` (i.e. baked into the published tarball). Its
bundled `ajv@8.18.0` pulls `fast-uri@3.1.0`, which is vulnerable to
GHSA-q3j6-qgpj-74h6 and GHSA-v39h-62p7-jpjc. npm `overrides` only
rewrite the resolution graph; they cannot rewrite files inside a
published tarball, so the bundled copy is unreachable. We allowlist
the two GHSAs in `audit-ci.jsonc` to keep CI green.

**Exit condition.** A future `aws-cdk-lib` release rebundles its
dependencies with a patched `fast-uri` (≥ 3.1.2) or patched `ajv`
(≥ 8.20.0). Verify by re-running `npx audit-ci --config ./audit-ci.jsonc`
locally and observing the absence of the
`Found vulnerable allowlisted advisories: GHSA-q3j6-qgpj-74h6,
GHSA-v39h-62p7-jpjc.` line. We're already on the latest aws-cdk-lib
(`2.253.1`); nothing to do until they cut a new minor.

**The change when the time comes.**

- [ ] Bump `aws-cdk-lib` if a newer version is out, run `npm install`,
      and verify `npm ls fast-uri` shows 3.1.2+ everywhere (including
      under `aws-cdk-lib/node_modules/`).
- [ ] Delete the two GHSA entries from the `allowlist` in
      `audit-ci.jsonc`. Leave `"high": true`.
- [ ] If the allowlist becomes empty, the file can stay (cheap docs)
      or be replaced by inline flags — author's call.

## Workaround 2 — `jest-runtime` pin in `overrides`

**Why it exists.** `jest-runtime` 30.4.0 / 30.4.1 / 30.4.2 (the
latest) call `this._moduleMocker.clearMocksOnScope(...)` from
`Runtime.resetModules`, but no published `jest-mock` has that method
— the matching `jest-mock@30.4.2` was never released. Symptom: every
mobile test suite fails with `TypeError: ... clearMocksOnScope is not
a function` on `npm test`. We pin `jest-runtime` to `30.3.0` (the
last release without the broken call) via `overrides` in root
`package.json`. This produces `invalid:` warnings from `npm ls` (the
parent jest packages declare `^30.4.x`) which are expected.

**Exit condition.** `jest-mock` publishes a version `≥ 30.4.2` that
exposes `clearMocksOnScope`. Verify with:

```bash
npm view jest-mock@latest version
# expect 30.4.2 or higher
npm pack jest-mock@latest --dry-run 2>&1
grep clearMocksOnScope $(npm pack jest-mock@latest --dry-run | …)  # method should be defined
```

**The change when the time comes.**

- [ ] Confirm the matching `jest-mock` is on npm and has the method.
- [ ] Delete the `"jest-runtime": "30.3.0"` line from `overrides`
      and the matching `//overrides` comment.
- [ ] `rm -rf node_modules package-lock.json && npm install` (npm
      doesn't fully re-resolve transitive overrides on an existing
      lockfile — same behaviour we hit when adding the pin).
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
