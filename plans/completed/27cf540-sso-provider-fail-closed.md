# Fail closed when a provider name resolves to more than one tenant

**Status:** COMPLETE — shipped `27cf540` (PR #456), deployed to prod 2026-07-17 02:27 UTC.

**Branch:** `fix/sso-provider-fail-closed`

## Checklist

- [x] `pre-token.ts`: `findMany` + require exactly one row; >1 ⇒ deny, loudly.
      Verified the new test fails when the ambiguity check is removed.
- [x] `schema.prisma`: fixed the stale `contactEmail` comment that caused the false finding
- [x] `pre-sign-up.ts`: corrected the comment citing `contactEmail`; the re-check itself
      stays (AWS leaves the `email` filter's case semantics undocumented)
- [x] `plans/completed/a523933-…`: struck through the false claim with a dated correction
      rather than deleting it — the archive is the record of what was believed, but a
      statement that contradicts the code is a trap. Additive, not a rewrite.
- [x] `contactEmail` validation left **unchanged** — it is CRM data, not auth data
- [x] Gates: `npm test`, `npm run typecheck`, `npm run lint`
- [x] PR → merge queue (#456, `27cf540`), deployed 2026-07-17 02:27 UTC. Prod holds 2
      provider rows (`Microsoft`, `Microsoft-SAML`), each unique ⇒ the deny branch is
      unreachable there and no login behavior changed.

**Goal:** `pre-token.ts` must not resolve a federated login's tenant from an ambiguous
provider lookup. Plus two documentation corrections — one of which is a false claim I put
into live code.

---

## 1. The real bug — `pre-token.ts` trusts a non-unique column

```ts
const provider = await db.tenantSsoProvider.findFirst({
  where: { cognitoProviderName: providerName }, // no tenant scope, no orderBy
  select: { tenantId: true, isEnabled: true },
})
```

`TenantSsoProvider` is `@@unique([tenantId, cognitoProviderName])` — **per tenant, not
pool-wide**. So two tenants CAN hold rows with the same `cognitoProviderName`, and
`findFirst` picks one arbitrarily. If it picks the wrong one, a federated login resolves to
**another tenant** — the #443 escalation class.

`sso.ts:387-390` already documents the mismatch in its own words:

> "The user pool is shared across tenants, so Cognito's ProviderName is unique per POOL,
> while the DB constraint is only [tenantId, cognitoProviderName]. A name another tenant
> already holds passes the DB check and fails here."

**How the duplicate state is reachable:** `sso.ts` creates the DB row FIRST, then calls
Cognito, then deletes the row if Cognito rejects the name (`sso.ts:385`). Cognito is what
keeps names unique — not the database. If that rollback never runs (Lambda timeout, crash,
network fault in the window between create and delete), a stray duplicate row survives.
Nothing cleans it up, and `findFirst` may then prefer it over the legitimate row.

So today's safety rests on: (a) Cognito rejecting duplicate names, and (b) a rollback always
completing. (b) is not guaranteed.

### Fix — require exactly one match

Mirror `pre-sign-up.ts`, which already refuses to guess:

```ts
const providers = await db.tenantSsoProvider.findMany({
  where: { cognitoProviderName: providerName },
  select: { tenantId: true, isEnabled: true },
})
// 0 → unknown provider (existing deny). >1 → undecidable ⇒ deny, loudly.
```

Fail **closed**: a federated login whose tenant cannot be resolved unambiguously is denied,
not guessed. This is the opposite trade-off from `pre-sign-up.ts`, where ambiguity means
"don't link" (a no-op) — here the login itself is what's at stake, and issuing claims for a
possibly-wrong tenant is the worst outcome available.

**Not doing** (decided): a global unique index on `cognitoProviderName`. It is the stronger
root-cause fix and the DB _should_ mirror the pool, but it needs a migration that fails if
any environment already holds duplicates (prod holds exactly one provider row; staging/QA
unverified) and it changes `sso.ts`'s error path from Cognito's 409 to a P2002. Worth its
own change. Fail-closed removes the dependency on that constraint existing.

## 2. `contactEmail` — a FALSE POSITIVE I reported, now corrected

I claimed `admin/tenants.ts` creates native Cognito users without lowercasing, so mixed-case
emails exist. **That is wrong.** Traced properly:

- `adminEmail: z.string().trim().email().toLowerCase()` (`admin/tenants.ts:56`) — already
  normalized, with a comment explaining that Cognito usernames are case-sensitive.
- `provisionCognitoUser(body.adminEmail, …)` (`:194`) — the Cognito user comes from
  `adminEmail`.
- `email: body.adminEmail.toLowerCase()` (`:261`) — the TenantUser row too.
- `contactEmail` (`:250`, `:334`) only lands on the **Tenant** record. It never creates a
  Cognito user or a roster row. It is CRM/display data.

`contactEmail`'s validation is therefore left alone — lowercasing a display field would
destroy user-entered formatting to fix nothing.

**Where the false claim came from, and where it must be corrected:**

- `apps/api/prisma/schema.prisma:438` says `POST /api/admin/tenants (creates ADMIN for the
contactEmail)` — **stale and wrong**; it is `adminEmail`. This is what misled me. FIX IT.
- `apps/api/src/cognito/pre-sign-up.ts` — my Step 3 comment cites the `contactEmail` gap as
  the reason for its case-insensitive re-check. The re-check STAYS (AWS genuinely leaves the
  `email` ListUsers filter's case semantics undocumented — `username` is annotated
  case-sensitive, `cognito:user_status` case-insensitive, `email` unannotated), but its
  stated justification is false. FIX THE COMMENT, KEEP THE CODE.

Method note worth keeping: the finding came from `contactEmail` and `AdminCreateUserCommand`
appearing near each other in grep output plus a stale comment — a data flow inferred from
co-occurrence rather than traced. Trace it.

## Tests (`pre-token.test.ts`)

- two provider rows share the name ⇒ **deny** (no claims issued, no tenant guessed)
- exactly one row ⇒ unchanged behavior (the #443 binding still resolves)
- zero rows ⇒ unchanged (existing unknown-provider deny)
- the existing federated suite must pass untouched — this only changes the ambiguous case

## Verification

`npm test`, `npm run typecheck`, `npm run lint`. No prod verification needed: this changes
only a case that cannot currently be reached in prod (one provider row exists pool-wide), and
the single-match path is byte-identical in behavior. The `#453` login rules are unaffected.

## Out of scope

- The global unique index (above).
- `sso.ts`'s create-then-rollback ordering — the window is the root cause of the stray row.
  Creating the Cognito provider first, or a reconciliation sweep, is a real fix but a
  separate design.
- RBAC on `sso.ts` (no server-side check; any authenticated tenant session can manage
  providers) — still open from the #451 plan.
