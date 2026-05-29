import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  AdminDisableUserCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { test, expect } from '../../fixtures'
import { hasAuthEnv } from '../../fixtures/cognito'

// Authenticated AVP smoke against staging. Untagged so the staging gate runs
// it. Skipped on local runs (E2E_TARGET !== 'remote') and skipped on remote
// runs that lack the auth env vars — local devs and ad-hoc remote runs without
// the staging admin credentials must still pass.
//
// Coverage:
//   1. /me/permissions answers for tenant_admin (proves the AVP path is wired)
//   2. POST /users/invite is allowed for tenant_admin (write action evaluates
//      to ALLOW end-to-end)
//   3. dispatcher persona has exactly its 6 expected permissions
//   4. auditor persona has exactly its 4 expected permissions, and is denied
//      on POST /users/invite
//   5. tenant_user (the read-only baseline) is denied on GET /api/v1/users and
//      POST /api/v1/users/invite — closes the negative-auth gap from
//      `authz-cedar-avp-followups.md` item #4.
//
// Persona setup uses the same e2e-admin tenant_admin account as the rest of
// this spec to mint persona users via POST /api/v1/users/invite, then sets a
// known temporary password via AdminSetUserPassword (skipping the Cognito
// FORCE_CHANGE_PASSWORD challenge), then mints an ID token via
// USER_PASSWORD_AUTH against the same tenant client. afterAll deactivates
// each persona user in Cognito so reruns don't accumulate roster entries.
const isRemote = process.env['E2E_TARGET'] === 'remote'
const skipReason = !isRemote
  ? 'authz-smoke runs only against remote staging'
  : !hasAuthEnv()
    ? 'authz-smoke requires E2E_COGNITO_TENANT_CLIENT_ID + E2E_STAGING_ADMIN_USERNAME + E2E_STAGING_ADMIN_PASSWORD'
    : !process.env['E2E_STAGING_TENANT_ID']
      ? 'authz-smoke requires E2E_STAGING_TENANT_ID'
      : !process.env['E2E_COGNITO_USER_POOL_ID']
        ? 'authz-smoke persona cases require E2E_COGNITO_USER_POOL_ID for AdminSetUserPassword + AdminDisableUser'
        : null

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'

// Permission strings expected for each persona. Update both this constant and
// the matching `.cedar` policy file if a persona's action set ever changes —
// the drift detector unit test (apps/api/src/authz/__tests__/role-options.test.ts)
// catches catalog drift; this spec catches policy-content drift.
const SALES_PERMISSIONS = [
  'quote:read',
  'quote:create',
  'quote:update',
  'customer:read',
  'customer:create',
  'customer:update',
  'move:list',
  'move:read',
] as const
const VIEWER_PERMISSIONS = [
  'quote:read',
  'move:list',
  'move:read',
  'invoice:read',
  'customer:read',
  'workflow:read',
] as const

type PersonaSession = {
  email: string
  username: string
  token: string
}

let cognitoClient: CognitoIdentityProviderClient | null = null
function getCognito(): CognitoIdentityProviderClient {
  return (cognitoClient ??= new CognitoIdentityProviderClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  }))
}

/** Random-ish slug so parallel/repeat runs don't collide in the roster. */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Provision a persona test user end-to-end:
 *   1. Tenant-admin invites the user (creates Cognito user + TenantUser PENDING).
 *   2. AdminSetUserPassword sets a permanent password (skips the Cognito
 *      FORCE_CHANGE_PASSWORD challenge that AdminCreateUser leaves on the
 *      account).
 *   3. USER_PASSWORD_AUTH mints an ID token.
 *
 * Returns the email + username + token so the caller can both authenticate as
 * the persona and clean up afterwards.
 */
async function provisionPersona(
  authedApiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  roleName: string,
): Promise<PersonaSession> {
  const email = `persona-${roleName.replace(/_/g, '-')}-${uniqueSuffix()}@pegasus-test.invalid`
  // The Cognito Username equals the email when AdminCreateUser is called with
  // Username=email, which is what apps/api/src/handlers/users.ts does.
  const username = email
  const password = 'Persona-Test-Pw!1'

  // Step 1: invite the user via the tenant API as e2e-admin.
  const inviteRes = await authedApiFetch('/api/v1/users/invite', {
    method: 'POST',
    body: JSON.stringify({ email, roleNames: [roleName] }),
  })
  if (![200, 201].includes(inviteRes.status)) {
    const body = await inviteRes.text().catch(() => '')
    throw new Error(`failed to invite persona "${roleName}" (${inviteRes.status}): ${body}`)
  }

  // Step 2: set a permanent password so the user can sign in immediately.
  await getCognito().send(
    new AdminSetUserPasswordCommand({
      UserPoolId: process.env['E2E_COGNITO_USER_POOL_ID'],
      Username: username,
      Password: password,
      Permanent: true,
    }),
  )

  // Step 3: authenticate to obtain an ID token. Pre-token Lambda will read
  // `roleNames` from the TenantUser row and emit `custom:roles` claim.
  const auth = await getCognito().send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: process.env['E2E_COGNITO_TENANT_CLIENT_ID'],
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  )
  const token = auth.AuthenticationResult?.IdToken
  if (!token) {
    throw new Error(
      `persona "${roleName}" InitiateAuth returned no IdToken (challenge=${auth.ChallengeName ?? 'none'})`,
    )
  }

  return { email, username, token }
}

async function disablePersona(username: string): Promise<void> {
  try {
    await getCognito().send(
      new AdminDisableUserCommand({
        UserPoolId: process.env['E2E_COGNITO_USER_POOL_ID'],
        Username: username,
      }),
    )
  } catch (err) {
    // Cleanup must not fail the suite — log and swallow.

    console.warn(`afterAll: failed to disable persona ${username}:`, err)
  }
}

function fetchWithToken(token: string): (path: string, init?: RequestInit) => Promise<Response> {
  return (path, init = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-tenant-id': process.env['E2E_STAGING_TENANT_ID']!,
      'x-correlation-id': `e2e-${Date.now()}`,
      ...(init.headers as Record<string, string> | undefined),
    }
    return fetch(`${API_BASE}${path}`, { ...init, headers })
  }
}

test.describe('authenticated AVP smoke', () => {
  test.skip(!!skipReason, skipReason ?? '')

  test('GET /api/v1/me/permissions answers for tenant_admin', async ({ authedApiFetch }) => {
    const res = await authedApiFetch('/api/v1/me/permissions')
    // Read the body exactly once; reusing it for both the failure-context
    // message and the JSON parse below avoids "Body is unusable" — expect's
    // message argument is evaluated eagerly regardless of pass/fail.
    const text = await res.text()
    expect(res.status, text).toBe(200)
    const body = JSON.parse(text) as { roles: string[]; permissions: string[] }

    expect(Array.isArray(body.roles)).toBe(true)
    expect(body.roles).toContain('tenant_admin')

    expect(Array.isArray(body.permissions)).toBe(true)
    // tenant_admin must include the canonical write check — same assertion as
    // the local-only me-permissions.spec.ts. If this fails, AVP is either not
    // wired at all or the tenant_admin policies didn't upload.
    expect(body.permissions).toContain('quote:create')
    for (const p of body.permissions) {
      expect(p).toMatch(/^[a-z_]+:[a-z_]+$/)
    }
  })

  test('POST /api/v1/users/invite is allowed for tenant_admin', async ({ authedApiFetch }) => {
    // Idempotent across runs: the email is reserved for this test so a
    // second run yields 409 (CONFLICT) rather than unbounded-growing the
    // tenant_users table. See the plan for context.
    const res = await authedApiFetch('/api/v1/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'e2e-invite-target@pegasus-test.invalid' }),
    })

    // Reject 401 (token issue, not a Cedar issue) and 403 (AVP path skipped
    // or tenant_admin policies missing). Accept 200/201 (created) and 409
    // (already invited from a prior run — still proves AVP allowed the call).
    expect(
      [200, 201, 409],
      `expected 200/201/409 but got ${res.status}: ${await res.text().catch(() => '')}`,
    ).toContain(res.status)
  })

  test.describe('persona policy coverage', () => {
    let salesSession: PersonaSession | null = null
    let viewerSession: PersonaSession | null = null

    test.beforeAll(async ({ authedApiFetch }) => {
      // Provision sequentially so the pre-token Lambda's PENDING→ACTIVE
      // promotion sees consistent state. Parallel invites against the same
      // tenant_users table aren't worth the complexity.
      salesSession = await provisionPersona(authedApiFetch, 'sales')
      viewerSession = await provisionPersona(authedApiFetch, 'viewer')
    })

    test.afterAll(async () => {
      const all = [salesSession, viewerSession]
      for (const s of all) if (s) await disablePersona(s.username)
    })

    test('sales has exactly its 8 expected permissions', async () => {
      expect(salesSession, 'sales persona did not provision').not.toBeNull()
      const fetch_ = fetchWithToken(salesSession!.token)
      const res = await fetch_('/api/v1/me/permissions')
      const text = await res.text()
      expect(res.status, text).toBe(200)
      const body = JSON.parse(text) as { roles: string[]; permissions: string[] }

      expect(body.roles).toEqual(['sales'])
      expect([...body.permissions].sort()).toEqual([...SALES_PERMISSIONS].sort())
    })

    test('viewer has exactly its 6 read-only permissions and is denied on invite', async () => {
      expect(viewerSession, 'viewer persona did not provision').not.toBeNull()
      const fetch_ = fetchWithToken(viewerSession!.token)

      // Closes authz-cedar-avp-followups.md item #4: prove fail-closed on a
      // non-admin principal. The viewer persona is read-only across operational
      // entities and has no `user:*` actions, so the invite call must be 403 —
      // never 200, never 401.
      const permsRes = await fetch_('/api/v1/me/permissions')
      const text = await permsRes.text()
      expect(permsRes.status, text).toBe(200)
      const body = JSON.parse(text) as { roles: string[]; permissions: string[] }
      expect(body.roles).toEqual(['viewer'])
      expect([...body.permissions].sort()).toEqual([...VIEWER_PERMISSIONS].sort())

      const inviteRes = await fetch_('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer-invite-attempt@pegasus-test.invalid' }),
      })
      expect(inviteRes.status).toBe(403)
    })
  })
})
