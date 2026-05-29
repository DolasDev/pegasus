# Mobile Cognito SDK — clear the js-cookie advisory (GHSA-qjx8-664m-686j)

## Context

The `audit-ci` CI gate on `main` is red on a single high advisory: **GHSA-qjx8-664m-686j**
(prototype-hijack in `js-cookie`'s `assign()`). The vulnerable `js-cookie@2.2.1` enters the
tree only as a transitive dependency of `amazon-cognito-identity-js@6.3.16` in `apps/mobile`.

We deliberately did **not** mask it with an allowlist — the user's standing direction is "no
hacks to avoid upgrading old dependencies." The original assumption was that fixing it required
a full migration off the (effectively abandoned) `amazon-cognito-identity-js` SDK, since:

- `amazon-cognito-identity-js@6.3.16` is the **latest** published version, and it still hard-pins
  `js-cookie@^2.2.1` (`>=2.2.1 <3.0.0`), so the patched `js-cookie@3.0.7` is unreachable by
  normal resolution.
- `js-cookie` is **not** a direct dependency anywhere, so it can't simply be bumped.

## Key finding — there is no migration to do

Investigation (2026-05-22) shows **`amazon-cognito-identity-js` is an orphan dependency**:

- It is referenced in exactly one place in the entire repo — `apps/mobile/package.json:24` —
  and is **imported by zero source/test/config files**:
  ```
  $ grep -rn "amazon-cognito-identity-js" apps/mobile --include=*.ts --include=*.tsx --include=*.json
  apps/mobile/package.json:24:    "amazon-cognito-identity-js": "^6.3.16",
  ```
- Mobile auth already runs **entirely on `@pegasus/auth`'s REST client** (`cognitoApiRequest`,
  `InitiateAuth` USER_PASSWORD_AUTH flow) — see `apps/mobile/src/auth/cognitoService.ts`. No
  `CognitoUser` / `CognitoUserPool` / `AuthenticationDetails` usage anywhere.
- `@pegasus/auth` does **not** depend on `amazon-cognito-identity-js`.
- `npm ls amazon-cognito-identity-js` confirms `apps/mobile` is the **only** consumer and it's a
  direct (not pulled-in) dep:
  ```
  @pegasus/mobile -> ./apps/mobile
  └── amazon-cognito-identity-js@6.3.16
       └── js-cookie@2.2.1
  ```

The SDK is dead weight left over from an earlier auth approach that was replaced by the shared
REST client. **The fix is to delete the unused dependency**, which removes `js-cookie` from the
tree entirely and clears the advisory — no migration, no override, no allowlist.

## Plan

Single change, executed via the merge-locally-then-push protocol (see
`feedback_batch_worktree_merge_push` memory).

1. **Remove the orphan dep** from `apps/mobile/package.json`:
   - delete line `"amazon-cognito-identity-js": "^6.3.16",`
2. **Regenerate the lockfile**: `npm install`. Expect `js-cookie` and `amazon-cognito-identity-js`
   to disappear from `package-lock.json`; no other intended changes.
3. **Verify the dep is gone**:
   - `npm ls amazon-cognito-identity-js` → "(empty)" / not found
   - `npm ls js-cookie` → not found (no other consumer exists)
4. **Verify the advisory is cleared** with the empty allowlist already in `audit-ci.jsonc`:
   - `npx --no-install audit-ci --config ./audit-ci.jsonc` → **passes** (no high/critical)
5. **Gate**: confirm nothing depended on it at build time:
   - `npm test --workspace apps/mobile` (173 tests as of this writing)
   - `npm run typecheck`
   - sanity: `apps/mobile` still builds its auth path (the cognitoService tests cover signIn).
6. **Land**: clean `main` of any WIP (stash), commit just `apps/mobile/package.json` +
   `package-lock.json`, run the gate on the clean tree, push `main` (this auto-deploys via the
   path filter — mobile isn't a deploy target, but the shared lockfile change may re-trigger
   component deploys; that's fine), restore WIP. Then confirm CI's "Audit dependencies" step is
   finally green and the required "Test" check passes end-to-end.

## Files

```
apps/mobile/package.json      (remove one line)
package-lock.json             (regenerated — js-cookie + amazon-cognito-identity-js drop out)
```

`audit-ci.jsonc` needs no change — its allowlist is already empty (fast-uri + tanstack entries
removed in commits 3a3d768 / bd91c9f); js-cookie was the sole remaining blocker.

## Verification (end-to-end)

- `npx --no-install audit-ci --config ./audit-ci.jsonc` exits 0.
- `npm test --workspace apps/mobile` + `npm run typecheck` green.
- After push: the CI run for the commit reaches and passes both "Audit dependencies" and "Run
  tests" (no longer short-circuited), turning the required "Test" status check green for the
  first time since the js-cookie advisory dropped (2026-05-21). Main CI fully green.

## Risk

Minimal. The only theoretical risk is a runtime `require('amazon-cognito-identity-js')` that
static grep can't see — implausible in a React Native app whose auth is already on the REST
client. The `apps/mobile` test suite + typecheck cover the auth path; if anything did reference
it, typecheck/tests/build would fail before the push.

## Note

This supersedes the larger "migrate off amazon-cognito-identity-js to
@aws-sdk/client-cognito-identity-provider" framing — that migration is unnecessary because the
SDK isn't actually used. If a future mobile feature needs server-side Cognito admin operations,
`@aws-sdk/client-cognito-identity-provider` (already used in `apps/api`) is the maintained
choice — but that's net-new work, not a prerequisite for clearing this advisory.
