# SSO — make pre-sign-up account linking idempotent

Status: not started. Follow-up from the wrong-Microsoft-account fix (PR #494, merged
2026-07-21). Small, self-contained, no infra change.

## The bug

During the 2026-07-21 incident, prod CloudWatch showed this at 18:02:10:

```
Pre-SignUp trigger: AdminLinkProviderForUser failed
  error: "SourceUser is already linked to DestinationUser"
→ throws: "Could not link your account. Please contact your administrator."
```

It fired 5 seconds after a _successful_ link of the same identity at 18:02:05 — a
duplicate `PreSignUp_ExternalProvider` invocation for an identity Cognito had already
linked. The trigger threw a scary user-facing error for what is, in fact, the exact
end state it was trying to produce: the federated identity IS linked to the native
user. The login recovered on the user's next attempt, so this is a spurious-error /
noise bug, not a broken-login bug — but it's a real user-facing "contact your
administrator" message for a success, and it pollutes the CloudWatch error stream.

## Root cause

`apps/api/src/cognito/pre-sign-up.ts` Step 4 (~line 291) calls
`AdminLinkProviderForUserCommand` inside a `try/catch` that rethrows **every** failure
as `'Could not link your account. Please contact your administrator.'`. The catch
comment deliberately does not swallow errors — for good reason (an unlinked sign-up
recreates the stray-duplicate bug the trigger exists to prevent). But
"already linked to this exact destination" is not that failure: it is the success
condition reached by a different path.

Cognito raises this as an error whose message contains
`SourceUser is already linked to DestinationUser`. The SDK exception type is not
reliably distinct enough to switch on (it surfaces as a generic
`InvalidParameterException`-family error), so match the **message substring**, the same
discipline PR #494 used for `error_description` — match a stable, meaningful substring,
not the whole string or its position.

## The fix

In the catch block, before the rethrow: if the error message includes
`already linked to DestinationUser` (case-insensitive, defensive), log at INFO
("federated identity was already linked — treating as success") and `return event`
instead of throwing. Every other error keeps the existing throw verbatim — do not widen
this. In particular, `AliasExistsException` must STILL throw: that means the link cannot
be made cleanly and a human needs to see it (the existing comment already calls this
out).

Extract the "is this the already-linked case?" check as a tiny named helper so the
intent is legible and testable in isolation, e.g.:

```ts
function isAlreadyLinked(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /already linked to DestinationUser/i.test(msg)
}
```

Keep the `assertedEmail`/`destinationUsername` log fields consistent with the
surrounding log lines (providerName, tenantId — never the raw email in the thrown
message).

## Why not just make the whole trigger idempotent upstream?

Considered: skip the link entirely if `ListUsers`/the native user already carries this
provider in `identities`. Rejected for this PR — it duplicates Cognito's own
idempotency check, adds a parsing path, and the AdminLink call is the authoritative
place to learn "already linked". Catching the specific error is smaller and closer to
the truth. Note it as a possible future simplification, not scope here.

## Tests

`apps/api/src/cognito/pre-sign-up.test.ts` — the harness already mocks
`AdminLinkProviderForUserCommand` (see `linkCall()` helper) and can make the mocked
`cognitoClient.send` reject.

- link rejects with `SourceUser is already linked to DestinationUser` → handler
  RESOLVES with the event (no throw), and logs the already-linked INFO line
- link rejects with `AliasExistsException`-style message → STILL throws
  `Could not link your account` (regression guard on the narrowed catch)
- link rejects with an arbitrary/unknown error → STILL throws (unchanged)
- unit-test `isAlreadyLinked` directly across: the real message, a differently-cased
  variant, an unrelated message, a non-Error thrown value
- the existing happy-path + trust-boundary tests still pass unchanged

## Verification

`npm run typecheck && npm test` green. No infra, no deploy-shape change — this is a
Lambda code change bundled by the existing CognitoStack `api` component path. No prod
action needed beyond the normal deploy; the next duplicate invocation simply logs INFO
instead of erroring.
