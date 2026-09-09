# Three #665 follow-ups: dependabot group split, temporal pin, postcss override

Three independent cleanups, all fallout from #665. Grouped into one workstream
because each is a few lines in a config file and all three are verified by the
same CI run.

## 1. Split the volatile deps out of the catch-all Dependabot group

**Why.** `.github/dependabot.yml` already carves `prisma`, `hono` and `cedar` into
their own groups, with a comment explaining that a 44-package grouped bump (#383)
wedged CI and that tree-reshuffling packages need to be independently reviewable.
#665 was the same failure again: one 57-package `minor-and-patch` PR carried three
unrelated breakages — `@temporalio/client` 1.18→1.23 (crossed a protobufjs major
our override capped, breaking 13 test files _and_ the API Lambda bundle),
`aws-cdk-lib`/`constructs` (synth ~2.5x slower, blew two test timeout budgets),
and `vitest` (in the same PR, worth isolating for the same reason).

**Change.** Three new groups mirroring the existing ones, plus matching
`exclude-patterns` on `minor-and-patch`:

- `temporal`: `@temporalio/*`
- `aws-cdk`: `aws-cdk-lib`, `constructs`, `aws-cdk`
- `vitest`: `vitest`, `@vitest/*`

Note `constructs` and `aws-cdk` (the CLI) belong with `aws-cdk-lib` — they move in
lockstep and a mismatched pair is its own failure mode.

Extend the existing comment rather than adding a second one; it already tells this
story and just needs #665 added as the second instance.

## 2. Relax the `@temporalio/client` exact pin

**Why.** `apps/api/package.json:41` pins `"@temporalio/client": "1.23.0"` with no
caret — the only exact pin in that file. `b55299e8` introduced it deliberately to
dodge protobufjs advisories that `@temporalio/proto` dragged in via its own exact
pin, and left a drop-back note: revert once `@temporalio/proto` ships a patched
protobufjs. #665 retired the corresponding `overrides.protobufjs` because that
condition was met. The pin is the other half of the same workaround and is now
equally obsolete.

**Change.** `"1.23.0"` → `"^1.23.0"`, matching every other dependency in the file.
Majors are still blocked by dependabot's `ignore: version-update:semver-major`.

**Verify.** Resolution must not move (`npm ls @temporalio/client` stays 1.23.0,
protobufjs stays split 7.6.3 root / 8.8.0 nested under temporal), and audit-ci
must still pass — that gate is why the pin existed.

## 3. Fix the duplicate `postcss` key in root `overrides`

**Why.** `package.json` has `"postcss"` twice: `:103` as a version floor
`">=8.5.18"` (added in #528) and `:136` as a nested `{ "nanoid": ">=3.3.17 <4" }`
(the nanoid advisory fix). JSON keeps the last, so the floor has never applied —
it is dead config that reads as protection.

**Change.** Merge into npm's combined form, which expresses both:

```json
"postcss": {
  ".": ">=8.5.18",
  "nanoid": ">=3.3.17 <4"
}
```

Add a `//overrides` comment covering both halves, since the floor currently has
none.

**Risk: low, and confirmed.** Exactly one postcss resolves today —
`node_modules/postcss` at **8.5.26**, already above the floor — so reviving it is
a no-op for resolution. The lockfile diff should be empty or trivial; if it is
not, stop and investigate rather than accepting churn.

## Verification (one pass, covers all three)

- `npm install --package-lock-only` → lockfile diff is empty or trivial
- `npm ls postcss` → single 8.5.26; nanoid under postcss still `>=3.3.17 <4`
- `npm ls @temporalio/client` → 1.23.0; `npm ls protobufjs` → 7.6.3 root, 8.8.0
  nested under temporal
- `npx audit-ci --config ./audit-ci.jsonc` → passes
- `turbo run typecheck lint test` → green (the api suite is the one that would
  notice a temporal resolution change)
- `.github/dependabot.yml` parses — GitHub validates on push; confirm no
  "dependabot.yml is invalid" annotation appears on the PR

## Out of scope

- Splitting the _remaining_ catch-all further. Three new groups is the response to
  observed failures, not a general reorganization.
- Any change to `overrides.protobufjs` (retired in #665) or the test timeout
  budgets (set in #665/#674).
