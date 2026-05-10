// ---------------------------------------------------------------------------
// E2E coverage for the tenant-scoped API-client → service-account → Cedar flow.
//
// Verifies the end-to-end story laid out in
// plans/in-progress/2026-05-10T0000-api-client-service-accounts.md:
//
//   1. A vendor key bound to a service-account TenantUser authenticates and
//      authorizes through the same Cedar/AVP pipeline as Cognito users.
//   2. Cedar grants/denies match the role assignment — `reporting` allows
//      ReadOrder, denies CreateOrder; `integrations` allows CreateEvent.
//   3. Stale rows (actsAsUserId = NULL) are rejected with
//      API_CLIENT_MISCONFIGURED before any handler runs.
//   4. Revoking the key short-circuits with FORBIDDEN.
//
// The /api/v1/orders and /api/v1/events handlers are M2M-only — there is no
// Cognito surface for them, so this spec is the only place the full vendor
// auth path is exercised end-to-end.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
const DATABASE_URL = process.env['DATABASE_URL']
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'
const TENANT_USER_ID = process.env['TEST_TENANT_USER_ID'] ?? 'e2e00000-0000-0000-0000-000000000002'

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  $disconnect: () => Promise<void>
}

async function getPrisma(): Promise<PrismaLike> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 ESM export compat (mirrors vpn.spec.ts).
  const mod: Record<string, any> = await import('@prisma/client')
  const PrismaClient = mod['PrismaClient'] ?? mod['default']?.PrismaClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter ESM export compat
  const adapterMod: Record<string, any> = await import('@prisma/adapter-pg')
  const PrismaPg = adapterMod['PrismaPg'] ?? adapterMod['default']?.PrismaPg
  const adapter = new PrismaPg({ connectionString: DATABASE_URL })
  return new PrismaClient({ adapter }) as PrismaLike
}

function buildApiKey(): { plainKey: string; keyPrefix: string; keyHash: string } {
  const hex = crypto.randomBytes(24).toString('hex')
  const plainKey = `vnd_${hex}`
  return {
    plainKey,
    keyPrefix: plainKey.slice(0, 12),
    keyHash: crypto.createHash('sha256').update(plainKey).digest('hex'),
  }
}

interface ServiceAccountClient {
  plainKey: string
  apiClientId: string
  serviceAccountId: string
}

/**
 * Insert a service-account TenantUser + ApiClient bound to it. Mirrors the
 * api-clients POST handler's transactional create — but writes raw SQL so the
 * test doesn't depend on Cognito-authed routes.
 */
async function seedServiceAccountClient(opts: {
  prisma: PrismaLike
  roleNames: string[]
  /** Override `acts_as_user_id` to null to simulate a stale (pre-migration) row. */
  stale?: boolean
  /** Override TenantUser.status. Defaults to ACTIVE. */
  status?: 'ACTIVE' | 'PENDING' | 'DEACTIVATED'
}): Promise<ServiceAccountClient> {
  const { prisma, roleNames, stale = false, status = 'ACTIVE' } = opts
  const { plainKey, keyPrefix, keyHash } = buildApiKey()
  const ts = Date.now().toString(36)
  const apiClientId = `e2e_ac_${ts}_${crypto.randomBytes(3).toString('hex')}`
  const serviceAccountId = `e2e_svc_${ts}_${crypto.randomBytes(3).toString('hex')}`

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.tenant_users
       (id, tenant_id, email, cognito_sub, is_service_account, role_names, status,
        invited_at, activated_at)
     VALUES ($1, $2, $3, NULL, true, $4, $5::"TenantUserStatus", NOW(), NOW())`,
    serviceAccountId,
    TENANT_ID,
    `svc-${serviceAccountId}@svc.invalid`,
    roleNames,
    status,
  )

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.api_clients
       (id, tenant_id, name, key_prefix, key_hash, scopes, created_by, acts_as_user_id,
        created_at, updated_at)
     VALUES ($1, $2, 'e2e-svc-account', $3, $4, ARRAY[]::text[], $5, $6, NOW(), NOW())`,
    apiClientId,
    TENANT_ID,
    keyPrefix,
    keyHash,
    TENANT_USER_ID,
    stale ? null : serviceAccountId,
  )

  return { plainKey, apiClientId, serviceAccountId }
}

async function revokeKey(prisma: PrismaLike, apiClientId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE public.api_clients SET revoked_at = NOW() WHERE id = $1`,
    apiClientId,
  )
}

async function cleanupClient(prisma: PrismaLike, client: ServiceAccountClient): Promise<void> {
  // ApiClient first (FK onDelete: Restrict on the service account).
  await prisma.$executeRawUnsafe(`DELETE FROM public.api_clients WHERE id = $1`, client.apiClientId)
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.tenant_users WHERE id = $1`,
    client.serviceAccountId,
  )
}

function vendorFetch(plainKey: string) {
  return async (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Requires local DB seeding; excluded from the remote staging gate.
//
// One service account per role-set keeps the spec narrow: each test asserts
// the policy decision for a single (role, action) pair without coupling to
// the cache-invalidation behaviour exercised by lib/authz.test.ts.
test.describe.serial('API-client service-account → Cedar flow @local-only', () => {
  let prisma: PrismaLike
  let reportingClient: ServiceAccountClient
  let integrationsClient: ServiceAccountClient

  test.beforeAll(async () => {
    prisma = await getPrisma()
    reportingClient = await seedServiceAccountClient({
      prisma,
      roleNames: ['reporting'],
    })
    integrationsClient = await seedServiceAccountClient({
      prisma,
      roleNames: ['integrations'],
    })
  })

  test.afterAll(async () => {
    if (reportingClient) await cleanupClient(prisma, reportingClient)
    if (integrationsClient) await cleanupClient(prisma, integrationsClient)
    await prisma.$disconnect()
  })

  test('reporting role → GET /api/v1/orders returns 200', async () => {
    const res = await vendorFetch(reportingClient.plainKey)('/api/v1/orders')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('reporting role → POST /api/v1/orders returns 403 (CreateOrder denied)', async () => {
    const res = await vendorFetch(reportingClient.plainKey)('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'e2e-user',
        scheduledDate: new Date().toISOString(),
        origin: {
          line1: '1 A St',
          city: 'A',
          state: 'AA',
          postalCode: '00000',
          country: 'US',
        },
        destination: {
          line1: '1 B St',
          city: 'B',
          state: 'BB',
          postalCode: '00001',
          country: 'US',
        },
      }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  test('reporting role → GET /api/v1/events/:type returns 200', async () => {
    const res = await vendorFetch(reportingClient.plainKey)('/api/v1/events/LEAD_CREATED')
    expect(res.status).toBe(200)
  })

  test('reporting role → POST /api/v1/events returns 403 (CreateEvent denied)', async () => {
    const res = await vendorFetch(reportingClient.plainKey)('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        eventApiId: `e2e-deny-${Date.now()}`,
        eventType: 'LEAD_CREATED',
      }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  test('integrations role → POST /api/v1/events returns 201', async () => {
    const res = await vendorFetch(integrationsClient.plainKey)('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        eventApiId: `e2e-allow-${Date.now()}`,
        eventType: 'LEAD_CREATED',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.eventType).toBe('LEAD_CREATED')

    // Best-effort cleanup: delete the event we just created via the same key.
    if (body.data?.id) {
      await vendorFetch(integrationsClient.plainKey)(`/api/v1/events/${body.data.id}`, {
        method: 'DELETE',
      })
    }
  })

  test('revoking the reporting key → 403 with code FORBIDDEN', async () => {
    await revokeKey(prisma, reportingClient.apiClientId)
    const res = await vendorFetch(reportingClient.plainKey)('/api/v1/orders')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })
})

test.describe('API-client service-account guard rails @local-only', () => {
  test('stale row (acts_as_user_id NULL) → 403 API_CLIENT_MISCONFIGURED', async () => {
    const prisma = await getPrisma()
    const client = await seedServiceAccountClient({
      prisma,
      roleNames: ['reporting'],
      stale: true,
    })
    try {
      const res = await vendorFetch(client.plainKey)('/api/v1/orders')
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.code).toBe('API_CLIENT_MISCONFIGURED')
    } finally {
      await cleanupClient(prisma, client)
      await prisma.$disconnect()
    }
  })

  test('deactivated service account → 403 SERVICE_ACCOUNT_INACTIVE', async () => {
    const prisma = await getPrisma()
    const client = await seedServiceAccountClient({
      prisma,
      roleNames: ['integrations'],
      status: 'DEACTIVATED',
    })
    try {
      const res = await vendorFetch(client.plainKey)('/api/v1/orders')
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.code).toBe('SERVICE_ACCOUNT_INACTIVE')
    } finally {
      await cleanupClient(prisma, client)
      await prisma.$disconnect()
    }
  })
})
