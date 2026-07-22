// ---------------------------------------------------------------------------
// Cognito Pre-Sign-Up Lambda trigger
//
// Links a first-time federated identity to the person's EXISTING native user in
// the same tenant, so one person = one Cognito user = one stable `sub`.
//
// Without this, federating an email that already has a native user creates a
// SECOND Cognito user: Cognito does not enforce email uniqueness for federated
// users even though the pool sets UsernameAttributes: ["email"]. Two users mean
// two `sub` claims, and middleware/tenant.ts resolves TenantUser by cognitoSub
// while pre-token.ts writes that field only once (PENDING→ACTIVE). Whichever
// identity did not write it misses the lookup — fail-open, so the session still
// works, which is exactly why it hides:
//   - userId is unset            ⇒ audit attribution silently lost
//   - a driver loses crewMemberId ⇒ Cedar ReadMove scoping breaks
//
// PreSignUp_ExternalProvider is the ONLY moment linking can happen:
// AdminLinkProviderForUser only works for an identity that has not yet signed in
// from its third-party IdP.
//
// TRUST BOUNDARY (established by PR #443 — do not re-litigate):
// the PROVIDER determines the tenant, never the asserted email. The pool is
// shared across tenants and each tenant registers its own IdP, so an IdP can
// assert any email it likes — including another tenant's admin. Linking by email
// means trusting the IdP's email claim, which is precisely why we only ever link
// within the provider's OWN tenant. AWS's own warning:
//
//   "Because this API allows a user with an external federated identity to sign
//    in as a local user, it is critical that it only be used with external IdPs
//    and linked attributes that you trust."
//
// FAIL-LOUD POLICY: this trigger fires on EVERY sign-up, including native ones.
// A throw here blocks account creation. So we branch on triggerSource first and
// native sign-ups always pass through untouched. Only the external-provider
// branch throws — a swallowed link failure would leave the stray unlinked
// account that is the whole bug being fixed here.
//
// Not linking is always safe: it is the status quo (a duplicate user), and
// pre-token.ts still resolves the tenant correctly from the authoritative
// `identities` attribute. Mis-linking is not safe. Every ambiguous case below
// therefore declines to link rather than guessing.
// ---------------------------------------------------------------------------

import type { PreSignUpTriggerHandler } from 'aws-lambda'
import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createLogger } from '../lib/logger'

const logger = createLogger('pegasus-pre-sign-up')

// Shared clients pool connections across warm invocations. As in pre-token.ts,
// the DATABASE_URL fallback prevents a module-level throw that would break test
// mocking (vi.mock replaces the constructor, but process.env is read first).
const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' })
const db = new PrismaClient({ adapter })
const cognitoClient = new CognitoIdentityProviderClient({})

// ---------------------------------------------------------------------------
// ListUsers filter values are a quoted mini-language, not parameterised: per the
// API reference, "Quotation marks within the filter string must be escaped using
// the backslash (\) character". The value here is an IdP-asserted email, so it
// gets escaped rather than trusted — the roster gate upstream happens to keep
// quotes out today, but that is a property of a distant validator, not of this
// call site.
// ---------------------------------------------------------------------------
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// ---------------------------------------------------------------------------
// Which IdP authenticated this sign-up?
//
// pre-token.ts reads the `identities` attribute, but that describes a user that
// already exists — at PreSignUp_ExternalProvider the user has not been created
// yet, so the provider is only legible from `userName`, which Cognito stamps as
// `<ProviderName>_<sub>`.
//
// That string cannot be split on the first `_`: BOTH halves may contain
// underscores. Provider names are tenant-chosen and sso.ts allows underscores
// (/^[a-zA-Z0-9_-]+$/), and Entra subs contain them too
// (Microsoft_zSmI_AFcBNlAm5zli…). A first-underscore split of `Acme_Evil_<sub>`
// yields `Acme` — which, if another tenant owns a provider called `Acme`, would
// resolve to THAT tenant and link a stranger's identity into it. That is the
// cross-tenant escalation #443 closed, reintroduced through a parser.
//
// So we never infer a name from the string shape. We enumerate the prefixes that
// COULD be provider names and let the database decide which one actually is.
// ---------------------------------------------------------------------------
export function providerNameCandidates(userName: string): string[] {
  const candidates: string[] = []
  for (let i = 0; i < userName.length; i++) {
    // Every `_` is a possible ProviderName/sub boundary. The prefix before it is
    // a candidate; a trailing `_` is not (it would leave an empty sub).
    if (userName[i] === '_' && i > 0 && i < userName.length - 1) {
      candidates.push(userName.slice(0, i))
    }
  }
  return candidates
}

// ---------------------------------------------------------------------------
// Is this AdminLinkProviderForUser failure just "already done"?
//
// Cognito fires PreSignUp_ExternalProvider more than once for a single login
// (observed in prod: a duplicate 5s after a successful link). The second call
// tries to link an identity Cognito already linked and fails with a message
// containing `SourceUser is already linked to DestinationUser`. That is not a
// failure — it is the exact end state this trigger exists to produce, reached by
// a different path — so it must not surface the "contact your administrator"
// error the generic catch throws.
//
// Match the message substring, not the exception type: Cognito raises this in the
// InvalidParameterException family, which is not distinct enough to switch on. As
// in pre-token.ts's marker matching, key off a stable, meaningful substring and
// nothing about its position. Deliberately NARROW — AliasExistsException and every
// other error still mean the link could not be made and must still throw.
// ---------------------------------------------------------------------------
export function isAlreadyLinkedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /already linked to DestinationUser/i.test(message)
}

export const handler: PreSignUpTriggerHandler = async (event) => {
  // -------------------------------------------------------------------------
  // Native sign-ups (PreSignUp_SignUp, PreSignUp_AdminCreateUser) are none of
  // this trigger's business. Branch FIRST and return the event untouched — a
  // throw below would block account creation for every invited user.
  // -------------------------------------------------------------------------
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') {
    return event
  }

  const userPoolId = event.userPoolId
  const userName = event.userName
  const assertedEmail = event.request.userAttributes['email']

  if (!userPoolId || !userName || !assertedEmail) {
    // Nothing actionable — decline to link rather than block the sign-in.
    // pre-token.ts denies at token time if the identity has no tenant claim.
    logger.error('Pre-SignUp trigger: missing userPoolId, userName, or email — not linking', {
      userPoolId: userPoolId ?? '(unset)',
      userName: userName ?? '(unset)',
      hasEmail: Boolean(assertedEmail),
    })
    return event
  }

  // -------------------------------------------------------------------------
  // Step 1 — Resolve the provider, and through it the tenant.
  //
  // Ask for every candidate prefix at once and require exactly one match. More
  // than one is genuinely undecidable: `Acme_Okta_123` is a valid userName for a
  // provider named `Acme` (sub `Okta_123`) AND for one named `Acme_Okta` (sub
  // `123`). Note TenantSsoProvider is unique per (tenantId, cognitoProviderName)
  // — NOT pool-wide — so duplicate names across tenants are representable here
  // even though Cognito would reject the second registration. Both cases land on
  // the same answer: do not guess which tenant, do not link.
  // -------------------------------------------------------------------------
  const candidates = providerNameCandidates(userName)

  if (candidates.length === 0) {
    logger.warn('Pre-SignUp trigger: userName has no provider/sub boundary — not linking', {
      userName,
    })
    return event
  }

  const providers = await db.tenantSsoProvider.findMany({
    where: { cognitoProviderName: { in: candidates } },
    select: { tenantId: true, cognitoProviderName: true, isEnabled: true },
  })

  if (providers.length === 0) {
    // Unknown provider. Not our tenant to touch; pre-token.ts denies at token time.
    logger.warn('Pre-SignUp trigger: no registered provider matches userName — not linking', {
      userName,
    })
    return event
  }

  if (providers.length > 1) {
    logger.error(
      'Pre-SignUp trigger: SECURITY — userName matches multiple registered providers, ' +
        'cannot resolve a tenant unambiguously; not linking',
      {
        userName,
        matched: providers.map((p) => p.cognitoProviderName),
      },
    )
    return event
  }

  const provider = providers[0]!

  if (!provider.isEnabled) {
    logger.warn('Pre-SignUp trigger: provider is disabled — not linking', {
      providerName: provider.cognitoProviderName,
    })
    return event
  }

  const tenantId = provider.tenantId
  const providerName = provider.cognitoProviderName
  const normalizedEmail = assertedEmail.toLowerCase()

  // -------------------------------------------------------------------------
  // Step 2 — Roster check, scoped to the PROVIDER'S OWN TENANT.
  //
  // This is the trust boundary in code. An email rostered only in a different
  // tenant must never be linked: that other tenant's account is not this
  // provider's to claim. Checked before ListUsers — it is the cheaper call and
  // the more restrictive gate.
  // -------------------------------------------------------------------------
  const tenantUser = await db.tenantUser.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: { not: 'DEACTIVATED' },
    },
    select: { id: true },
  })

  if (!tenantUser) {
    // No invite in this tenant. Strict invite-only: pre-token.ts denies at token
    // time, so there is nothing to link and nothing to block here.
    logger.info('Pre-SignUp trigger: email not rostered in the provider tenant — not linking', {
      providerName,
      tenantId,
    })
    return event
  }

  // -------------------------------------------------------------------------
  // Step 3 — Find the native Cognito user for this email.
  //
  // Federated users are EXTERNAL_PROVIDER and are excluded: linking to one is
  // not possible and not the goal. The pool enforces email uniqueness for native
  // users, so more than one native match is an anomaly we decline to resolve.
  //
  // The returned emails are re-checked here rather than trusting the filter to
  // mean what we think it means. The API reference annotates `username` as
  // case-sensitive and `cognito:user_status` as case-insensitive but says
  // NOTHING about `email`. Both paths that provision a user do lowercase first
  // (users.ts invite, admin/tenants.ts adminEmail), so a mismatch should not
  // arise from our own writes — but a pool is long-lived and this costs one
  // comparison, whereas trusting an undocumented filter costs a silent no-link.
  // Comparing lowercased on both sides is right under either behavior — a
  // case-insensitive filter returning `Steve@…` for `steve@…` is the same person
  // and should link, while anything that is not this email is rejected.
  // -------------------------------------------------------------------------
  const listed = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${escapeFilterValue(normalizedEmail)}"`,
      Limit: 10,
    }),
  )

  const emailOf = (user: UserType): string | undefined =>
    user.Attributes?.find((a) => a.Name === 'email')?.Value?.toLowerCase()

  const nativeUsers = (listed.Users ?? []).filter(
    (u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && emailOf(u) === normalizedEmail,
  )

  if (nativeUsers.length === 0) {
    logger.info('Pre-SignUp trigger: no native Cognito user for this email — not linking', {
      providerName,
      tenantId,
    })
    return event
  }

  if (nativeUsers.length > 1) {
    logger.error(
      'Pre-SignUp trigger: multiple native users share this email — not linking (anomaly)',
      { providerName, tenantId, count: nativeUsers.length },
    )
    return event
  }

  // Because UsernameAttributes: ["email"], Cognito generates a UUID Username and
  // email is only an attribute. DestinationUser.ProviderAttributeValue must be
  // that UUID Username, NOT the email (ProviderAttributeName is ignored for the
  // destination, and ProviderName must be the literal "Cognito").
  const destinationUsername = nativeUsers[0]!.Username

  if (!destinationUsername) {
    logger.error('Pre-SignUp trigger: native user has no Username — not linking', {
      providerName,
      tenantId,
    })
    return event
  }

  // -------------------------------------------------------------------------
  // Step 4 — Link. From here on, failures throw.
  //
  // Cognito_Subject is NOT required for OIDC (only social IdPs force it), so we
  // link by `email`, already mapped via AttributeMapping in sso.ts. Entra's `sub`
  // is pairwise per application ID and unknowable ahead of a first sign-in, so
  // email is the only workable source attribute anyway.
  //
  // The asserted email (not the normalized one) is the source value: it is what
  // the IdP will assert on the next sign-in, and that is what Cognito matches.
  // -------------------------------------------------------------------------
  try {
    await cognitoClient.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: userPoolId,
        DestinationUser: {
          ProviderName: 'Cognito',
          ProviderAttributeValue: destinationUsername,
        },
        SourceUser: {
          ProviderName: providerName,
          ProviderAttributeName: 'email',
          ProviderAttributeValue: assertedEmail,
        },
      }),
    )
  } catch (err) {
    // "Already linked to this exact destination" is a duplicate invocation, not a
    // failure — the identity IS linked, which is all we wanted. Treat it as
    // success so a retried trigger does not throw a user-facing error for a state
    // it reached a moment ago. See isAlreadyLinkedError for why we match the
    // message and why this stays narrow.
    if (isAlreadyLinkedError(err)) {
      logger.info(
        'Pre-SignUp trigger: federated identity was already linked — treating as success',
        {
          providerName,
          tenantId,
        },
      )
      return event
    }

    // Everything else is deliberately not swallowed. Letting the sign-up proceed
    // unlinked would recreate the stray duplicate user this trigger exists to
    // prevent — and it would do so silently, which is how the bug survived this
    // long. AliasExistsException lands here too: it means the link cannot be made
    // cleanly, which is a state a human needs to see rather than inherit later.
    logger.error('Pre-SignUp trigger: AdminLinkProviderForUser failed', {
      providerName,
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error('Could not link your account. Please contact your administrator.', {
      cause: err,
    })
  }

  logger.info('Pre-SignUp trigger: linked federated identity to existing native user', {
    providerName,
    tenantId,
  })

  return event
}
