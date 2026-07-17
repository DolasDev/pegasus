// ---------------------------------------------------------------------------
// Cognito Pre-Token-Generation Lambda trigger
//
// Injects custom claims into the ID token after successful authentication.
// The backend middleware relies on these claims so it does not have to
// re-evaluate context on every API request.
//
// Routing is based on callerContext.clientId (which Cognito app client
// initiated the auth), NOT on group membership. This cleanly separates
// admin and tenant login flows:
//
// ADMIN APP CLIENT:
//   No custom claims — admin gating uses the cognito:groups PLATFORM_ADMIN
//   membership directly via adminAuthMiddleware.
//
// TENANT / MOBILE APP CLIENT:
//   Resolve the active tenant, then look up the TenantUser record to determine
//   roleNames and status. Resolution order:
//
//     1. FEDERATED (signed in THROUGH an IdP — see isFederatedSignIn) — the identity
//        PROVIDER determines the tenant, via TenantSsoProvider.tenantId. The email is
//        never used to resolve a federated login. See the security note at Step 1a: the
//        user pool is shared across tenants and each tenant controls its own IdP,
//        so an asserted email is not a trustworthy tenant signal.
//        NOTE: "has an `identities` attribute" is NOT the test — a linked user carries
//        that on password logins too. Routing on it locked multi-tenant SSO users out of
//        every tenant but their provider's.
//     2. AuthSession (multi-tenant picker) — native logins only.
//     3. The user's tenant_users roster — native logins only.
//
//   ACTIVE      → inject custom:tenantId + custom:roles (Cedar groups)
//   PENDING     → first login: inject claims, set status=ACTIVE + activatedAt + cognitoSub
//   DEACTIVATED → block token generation (fail-closed)
//   Not found   → block token generation (strict invite-only)
//
// NO-GROUP ADMIN USERS:
//   Allow token issuance with no custom claims (admin setup flow only).
//   Tenant users with no groups proceed to full tenant resolution.
// ---------------------------------------------------------------------------

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from '../lib/logger'

const logger = createLogger('pegasus-pre-token')

// Use a shared client to pool connections across warm invocations.
// Prisma 7 requires an explicit driver adapter for database connections.
// In Lambda, DATABASE_URL is always injected by CDK. The fallback prevents
// a module-level throw that would break test mocking (vi.mock replaces the
// PrismaClient constructor, but process.env is checked before it runs).
const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' })
const db = new PrismaClient({ adapter })
const ssm = new SSMClient({})

// ---------------------------------------------------------------------------
// Admin client ID — read from SSM once at cold start, cached thereafter.
//
// The CDK stack stores the admin app client ID at this well-known path.
// Reading from SSM (instead of an env var) breaks a circular CloudFormation
// dependency: Lambda → UserPoolClient → UserPool → Lambda.
// ---------------------------------------------------------------------------
const ADMIN_CLIENT_ID_PARAM = '/pegasus/admin/cognito-admin-client-id'
let _adminClientId: string | null = null

async function getAdminClientId(): Promise<string> {
  if (_adminClientId) return _adminClientId

  const result = await ssm.send(new GetParameterCommand({ Name: ADMIN_CLIENT_ID_PARAM }))

  const value = result.Parameter?.Value
  if (!value) {
    throw new Error(`SSM parameter ${ADMIN_CLIENT_ID_PARAM} not found or empty`)
  }

  _adminClientId = value
  return value
}

// ---------------------------------------------------------------------------
// Federated identity — which IdP is linked to this user?
//
// Cognito delivers `identities` as a JSON STRING on users with a linked IdP identity
// and omits it entirely for purely-native ones:
//   [{"userId":"…","providerName":"AcmeOkta","providerType":"OIDC",…}]
//
// NOTE this answers "does this account HAVE a linked IdP identity?", NOT "did this
// sign-in come THROUGH that IdP?". Those were the same question until account linking
// (cognito/pre-sign-up.ts) started attaching `identities` to native users. See
// isFederatedSignIn() — do not use this alone to route a login.
//
// Anything unparseable, empty, or missing a providerName returns null and is handled
// as a native login — the strictly more restrictive path. An untrusted claim must
// never be able to *widen* what we do with it.
// ---------------------------------------------------------------------------
function extractProviderName(identitiesAttr: string | undefined): string | null {
  if (!identitiesAttr) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(identitiesAttr)
  } catch {
    return null
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const name = (parsed[0] as Record<string, unknown> | undefined)?.['providerName']
  return typeof name === 'string' && name.length > 0 ? name : null
}

// ---------------------------------------------------------------------------
// Did THIS sign-in come through the IdP?
//
// The `identities` attribute cannot answer that on its own. It describes the account,
// not the authentication: once cognito/pre-sign-up.ts links a federated identity to a
// person's native user (so one person = one Cognito user = one stable `sub`), that user
// carries `identities` FOREVER — including on password logins. Routing on presence alone
// therefore pinned every login by a linked user to the provider's tenant, and any other
// tenant pick died on the AuthSession-disagreement check below. That was a live prod
// break for a multi-tenant SSO user, not a theoretical one.
//
// `triggerSource` reports how the token was actually requested, which is the real
// question. It separates the two flows cleanly because of how the apps sign in:
//
//   - Native password → InitiateAuth USER_PASSWORD_AUTH (apps/tenant-web/src/auth/
//     cognito.ts) → TokenGeneration_Authentication. Never touches the hosted UI.
//   - Federated → /oauth2/authorize?identity_provider=<name> → TokenGeneration_HostedAuth.
//     The identity_provider hint skips the hosted UI's own password form, so for a tenant
//     app client HostedAuth means an IdP round-trip and nothing else.
//   - admin-web does use the hosted UI, but the admin client returns above, long before
//     tenant resolution.
//
// ⚠️ This couples us to that login design. If tenant password login is ever moved onto the
// hosted UI, a linked user would be misclassified as federated all over again. Change this
// check in the same commit as any such move.
//
// ⚠️ TokenGeneration_RefreshTokens is deliberately NOT treated as federated: no client in
// this repo refreshes today (every exchange is grant_type=authorization_code), so it never
// fires. Whoever adds refresh must decide how to resolve the tenant for a LINKED user —
// at refresh neither `identities` nor `triggerSource` distinguishes native from federated,
// and the AuthSession is 10-minute TTL (handlers/auth.ts) so it is long expired. Read this
// note before you wire one up.
//
// Fail-safe direction: anything unrecognised falls to the native path, which is strictly
// more restrictive — it still requires an AuthSession or an unambiguous roster row.
// ---------------------------------------------------------------------------
function isFederatedSignIn(
  triggerSource: string,
  providerName: string | null,
): providerName is string {
  return providerName !== null && triggerSource === 'TokenGeneration_HostedAuth'
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const groups: string[] = event.request.groupConfiguration?.groupsToOverride ?? []

  // -------------------------------------------------------------------------
  // Route by app client — admin and tenant flows are completely independent.
  // -------------------------------------------------------------------------
  const clientId = event.callerContext.clientId
  const adminClientId = await getAdminClientId()

  if (clientId === adminClientId) {
    // -----------------------------------------------------------------------
    // Admin client — no custom claims at all.
    //
    // Admin gating is enforced downstream by adminAuthMiddleware via the
    // PLATFORM_ADMIN cognito:groups membership (which Cognito injects into
    // the token automatically from the user's group memberships). Emitting
    // an additional `custom:role` claim was historically used for routing
    // but no production code reads it any more.
    // -----------------------------------------------------------------------
    logger.info('Pre-Token trigger: Admin client — no custom claims', {
      userName: event.userName,
      groupCount: groups.length,
    })
    return event
  }

  // -------------------------------------------------------------------------
  // TENANT / MOBILE APP CLIENT — full tenant resolution flow.
  // -------------------------------------------------------------------------
  const email = event.request.userAttributes.email
  const sub = event.request.userAttributes.sub

  if (!email) {
    logger.error('Pre-Token trigger: Missing email claim')
    throw new Error('Authentication failed: No email associated with identity')
  }

  const normalizedEmail = email.toLowerCase()
  const now = new Date()

  // Best-effort sweep of expired AuthSession rows. Sessions are no longer
  // deleted on read (they must survive the multi-invocation login burst —
  // initial auth + token refresh), so they are cleaned up by expiry here
  // instead. Fire-and-forget: never block token issuance on this.
  db.authSession.deleteMany({ where: { expiresAt: { lt: now } } }).catch((err: unknown) => {
    logger.warn('Pre-Token trigger: Failed to sweep expired AuthSessions', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  // -------------------------------------------------------------------------
  // Step 1: Check for a pending AuthSession (created by POST /api/auth/select-tenant).
  // If found, use its tenantId — this carries the user's explicit tenant pick
  // through the login, enabling multi-tenant users to land in the right org.
  // -------------------------------------------------------------------------
  // AuthSession.email is stored lowercase by select-tenant, so match with
  // the normalised email to avoid case-mismatch misses. The session is NOT
  // consumed on read: one login fires several PreTokenGeneration invocations
  // and they must all resolve consistently — it expires naturally instead.
  const authSession = await db.authSession.findFirst({
    where: { email: normalizedEmail, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tenantId: true },
  })

  let tenantId: string

  // -------------------------------------------------------------------------
  // Step 1a: Federated login — the PROVIDER determines the tenant.
  //
  // Tenants configure their own IdPs into a SHARED user pool, so an IdP can assert
  // any `email` it likes, including another tenant's admin. What it cannot forge is
  // which provider it is: Cognito stamps `providerName` from the pool's own
  // registration, and TenantSsoProvider.tenantId is OUR record of who owns that
  // provider. So the provider resolves the tenant, and the email never does.
  //
  // Resolving from the email (as this did until 2026-07-16) let any tenant with an
  // IdP mint another tenant's custom:tenantId + custom:roles — a cross-tenant
  // privilege escalation reachable from the SSO settings page. Cognito does not
  // enforce email uniqueness for federated users even with
  // UsernameAttributes: ["email"], so nothing else was standing in the way.
  // -------------------------------------------------------------------------
  const providerName = extractProviderName(event.request.userAttributes.identities)

  if (isFederatedSignIn(event.triggerSource, providerName)) {
    // findMany, not findFirst: `cognitoProviderName` is NOT unique on its own.
    // TenantSsoProvider is @@unique([tenantId, cognitoProviderName]) — per TENANT — so two
    // tenants can hold rows with the same name and findFirst would pick one arbitrarily
    // (no orderBy), silently resolving the login to whichever it happened to return.
    //
    // Only Cognito keeps these names unique pool-wide, and only at registration:
    // handlers/sso.ts writes the DB row FIRST, calls CreateIdentityProvider, and deletes
    // the row if Cognito rejects the name. A rollback that never runs (Lambda timeout,
    // crash, network fault in that window) leaves a stray duplicate behind, and nothing
    // sweeps it up. So "the database can't hold duplicates" is not a property we have.
    //
    // Fail CLOSED on ambiguity. Unlike cognito/pre-sign-up.ts — where not resolving a
    // provider merely skips linking — the tenant claim itself is at stake here, and
    // issuing another tenant's custom:tenantId + custom:roles is the exact escalation the
    // provider→tenant binding exists to prevent. Deny and make it loud.
    const providers = await db.tenantSsoProvider.findMany({
      where: { cognitoProviderName: providerName },
      select: { tenantId: true, isEnabled: true },
    })

    if (providers.length > 1) {
      logger.error(
        'Pre-Token trigger: SECURITY — provider name resolves to multiple tenants, refusing to guess',
        {
          email,
          providerName,
          tenantIds: providers.map((p) => p.tenantId),
        },
      )
      throw new Error('Authentication failed: identity provider configuration is ambiguous.')
    }

    const provider = providers[0]

    if (!provider) {
      logger.error('Pre-Token trigger: SECURITY — federated login via unknown provider', {
        email,
        providerName,
      })
      throw new Error('Authentication failed: unrecognised identity provider.')
    }

    if (!provider.isEnabled) {
      logger.warn('Pre-Token trigger: federated login via disabled provider', {
        email,
        providerName,
      })
      throw new Error('Authentication failed: this identity provider is disabled.')
    }

    tenantId = provider.tenantId

    // The login flow only ever routes a user to their own selected tenant's provider,
    // so a disagreement is an attack signal or a serious bug. Fail closed either way.
    if (authSession && authSession.tenantId !== tenantId) {
      logger.error('Pre-Token trigger: SECURITY — AuthSession tenant disagrees with provider', {
        email,
        providerName,
        sessionTenantId: authSession.tenantId,
        providerTenantId: tenantId,
      })
      throw new Error('Authentication failed: session does not match the identity provider.')
    }

    logger.info('Pre-Token trigger: Resolved tenant via SSO provider', {
      email,
      providerName,
      tenantId,
      triggerSource: event.triggerSource,
    })
  } else if (authSession) {
    // Use the session-selected tenant.
    // `linkedProvider` distinguishes "native login by a linked user" (the case that
    // regressed) from a never-federated one, without changing how either is routed.
    tenantId = authSession.tenantId
    logger.info('Pre-Token trigger: Resolved tenant via AuthSession', {
      email,
      tenantId,
      triggerSource: event.triggerSource,
      linkedProvider: providerName ?? '(none)',
    })
  } else {
    // -----------------------------------------------------------------------
    // Step 2: No pending session (e.g. a token refresh, which never carries
    // one) — resolve the tenant from the user's tenant_users roster.
    // -----------------------------------------------------------------------
    const rosterRows = await db.tenantUser.findMany({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: { not: 'DEACTIVATED' },
        tenant: { status: 'ACTIVE' },
      },
      select: { tenantId: true },
    })

    if (rosterRows.length === 0) {
      logger.warn('Pre-Token trigger: No tenant roster row for email', { email })
      throw new Error('Your account has not been granted access. Contact your administrator.')
    }

    if (rosterRows.length > 1) {
      // Cannot disambiguate without the tenant picker — force a fresh login.
      logger.warn('Pre-Token trigger: Multiple roster rows, no AuthSession', {
        email,
        count: rosterRows.length,
      })
      throw new Error('Your session has expired. Please sign in again.')
    }

    tenantId = rosterRows[0]!.tenantId
    logger.info('Pre-Token trigger: Resolved tenant via roster', {
      email,
      tenantId,
      triggerSource: event.triggerSource,
      linkedProvider: providerName ?? '(none)',
    })
  }

  // -------------------------------------------------------------------------
  // Look up the TenantUser roster entry for this email within the resolved tenant.
  // Strict invite-only — no JIT provisioning.
  // -------------------------------------------------------------------------
  const tenantUser = await db.tenantUser.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
    select: { id: true, roleNames: true, status: true },
  })

  if (!tenantUser) {
    logger.warn('Pre-Token trigger: User not in tenant roster', { email, tenantId })
    throw new Error('Your account has not been granted access. Contact your administrator.')
  }

  if (tenantUser.status === 'DEACTIVATED') {
    logger.warn('Pre-Token trigger: Deactivated user attempted login', {
      email,
      tenantId,
    })
    throw new Error('Your account has been deactivated. Contact your administrator.')
  }

  // -------------------------------------------------------------------------
  // PENDING → first login: activate the account.
  // -------------------------------------------------------------------------
  if (tenantUser.status === 'PENDING') {
    await db.tenantUser.update({
      where: { id: tenantUser.id },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        ...(sub ? { cognitoSub: sub } : {}),
      },
    })
    logger.info('Pre-Token trigger: First login — tenant user activated', {
      email,
      tenantId,
      roleNames: tenantUser.roleNames,
    })
  }

  // Cedar role-group memberships for AVP. Authoritative source is
  // tenantUser.roleNames. Empty roleNames yield no Cedar groups, which makes
  // every group-gated permit evaluate to false (empty /me/permissions and
  // 403 on requirePermission-guarded routes) — the correct fail-closed
  // outcome for a misconfigured user, surfaced loudly enough that an admin
  // can fix it via PATCH /users/:id.
  const cedarRoles = tenantUser.roleNames

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': tenantId,
        'custom:roles': JSON.stringify(cedarRoles),
      },
      // Mirror the Cedar role names into `cognito:groups` so the token shape
      // matches what AVP's Cognito identity source records expect. The API's
      // AVP backend doesn't read the claim (it builds the entity hierarchy
      // from custom:roles via lib/authz.ts), but keeping it lets future
      // groupConfiguration-based IdPs work without a pre-token Lambda change.
      groupOverrideDetails: {
        groupsToOverride: cedarRoles,
      },
    },
  }

  return event
}
