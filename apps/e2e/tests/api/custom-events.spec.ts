// ---------------------------------------------------------------------------
// E2E coverage for the tenant custom-events flow (registry + emit + trigger).
//
// Exercises the real HTTP → Cedar RBAC → Prisma path end-to-end with a seeded
// `vnd_` service account in the tenant_admin group (which holds ManageEventTypes,
// EmitTenantEvent, and ManageWorkflowTriggers):
//
//   1. POST /event-types registers a custom type with a payload schema.
//   2. GET /event-types lists it back.
//   3. POST /event-types/:name/emit with a valid payload → 201 AND a matching
//      DomainEvent outbox row is written (verified directly in the DB — proves
//      the emit wired through without waiting on the dispatcher tick).
//   4. Emit with a schema-violating payload → 400, no extra outbox row.
//   5. A workflow EVENT trigger accepts the custom event name (Unit 6 unblock).
//   6. Cleanup removes the trigger, the type, the outbox rows, and the account.
//
// Gated: needs a live API with CUSTOM_EVENTS_ENABLED=true and local DB seeding,
// so it carries @local-only and skips unless the flag env is set. The
// dispatcher-fired execution path (event → started run) is covered by the
// lambda-dispatch-workflow-triggers unit tests; this spec keeps to the
// deterministic synchronous surface to stay non-flaky.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')
test.skip(
  process.env['CUSTOM_EVENTS_ENABLED'] !== 'true',
  'CUSTOM_EVENTS_ENABLED not set for the target API — skipping custom-events E2E',
)

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 ESM export compat (mirrors other specs).
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

type ServiceAccountClient = { plainKey: string; apiClientId: string; serviceAccountId: string }

async function seedAdminClient(prisma: PrismaLike): Promise<ServiceAccountClient> {
  const { plainKey, keyPrefix, keyHash } = buildApiKey()
  const ts = Date.now().toString(36)
  const apiClientId = `e2e_ac_${ts}_${crypto.randomBytes(3).toString('hex')}`
  const serviceAccountId = `e2e_svc_${ts}_${crypto.randomBytes(3).toString('hex')}`

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.tenant_users
       (id, tenant_id, email, cognito_sub, is_service_account, role_names, status,
        invited_at, activated_at)
     VALUES ($1, $2, $3, NULL, true, $4, 'ACTIVE'::"TenantUserStatus", NOW(), NOW())`,
    serviceAccountId,
    TENANT_ID,
    `svc-${serviceAccountId}@svc.invalid`,
    ['tenant_admin'],
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.api_clients
       (id, tenant_id, name, key_prefix, key_hash, scopes, created_by, acts_as_user_id,
        created_at, updated_at)
     VALUES ($1, $2, 'e2e-custom-events', $3, $4, ARRAY[]::text[], $5, $6, NOW(), NOW())`,
    apiClientId,
    TENANT_ID,
    keyPrefix,
    keyHash,
    TENANT_USER_ID,
    serviceAccountId,
  )
  return { plainKey, apiClientId, serviceAccountId }
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

test.describe.serial('Tenant custom events → registry + emit + trigger @local-only', () => {
  let prisma: PrismaLike
  let client: ServiceAccountClient
  let call: ReturnType<typeof vendorFetch>
  const eventTypeName = `e2e.custom.${Date.now().toString(36)}`
  let createdTriggerId: string | null = null
  let triggerWorkflowId: string | null = null

  test.beforeAll(async () => {
    prisma = await getPrisma()
    client = await seedAdminClient(prisma)
    call = vendorFetch(client.plainKey)
  })

  test.afterAll(async () => {
    if (triggerWorkflowId && createdTriggerId) {
      await call(`/api/v1/workflows/${triggerWorkflowId}/triggers/${createdTriggerId}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    await call(`/api/v1/event-types/${eventTypeName}`, { method: 'DELETE' }).catch(() => {})
    await prisma
      .$executeRawUnsafe(
        `DELETE FROM public.domain_events WHERE tenant_id = $1 AND event_type = $2`,
        TENANT_ID,
        eventTypeName,
      )
      .catch(() => {})
    await prisma
      .$executeRawUnsafe(`DELETE FROM public.api_clients WHERE id = $1`, client.apiClientId)
      .catch(() => {})
    await prisma
      .$executeRawUnsafe(`DELETE FROM public.tenant_users WHERE id = $1`, client.serviceAccountId)
      .catch(() => {})
    await prisma.$disconnect()
  })

  test('registers a custom event type with a payload schema (201)', async () => {
    const res = await call('/api/v1/event-types', {
      method: 'POST',
      body: JSON.stringify({
        name: eventTypeName,
        description: 'E2E custom event',
        payloadSchema: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        },
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { name: string } }
    expect(body.data.name).toBe(eventTypeName)
  })

  test('lists the new event type', async () => {
    const res = await call('/api/v1/event-types')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ name: string }> }
    expect(body.data.some((t) => t.name === eventTypeName)).toBe(true)
  })

  test('emits a valid payload (201) and writes one outbox row', async () => {
    const res = await call(`/api/v1/event-types/${eventTypeName}/emit`, {
      method: 'POST',
      body: JSON.stringify({ payload: { orderId: 'o-e2e-1' } }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { emitted: boolean; eventType: string } }
    expect(body.data.emitted).toBe(true)
    expect(body.data.eventType).toBe(eventTypeName)

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM public.domain_events
        WHERE tenant_id = $1 AND event_type = $2`,
      TENANT_ID,
      eventTypeName,
    )
    expect(Number(rows[0]?.count ?? 0)).toBe(1)
  })

  test('rejects a payload that violates the schema (400), no extra row', async () => {
    const res = await call(`/api/v1/event-types/${eventTypeName}/emit`, {
      method: 'POST',
      body: JSON.stringify({ payload: { wrong: true } }),
    })
    expect(res.status).toBe(400)
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM public.domain_events
        WHERE tenant_id = $1 AND event_type = $2`,
      TENANT_ID,
      eventTypeName,
    )
    expect(Number(rows[0]?.count ?? 0)).toBe(1) // still just the one valid emit
  })

  test('a workflow EVENT trigger accepts the custom event name (Unit 6)', async () => {
    // Best-effort: needs a workflow in the tenant to attach to. If the tenant
    // has none, this assertion is skipped rather than failing the suite.
    const wfRes = await call('/api/v1/workflows')
    const wfBody = (await wfRes.json()) as { data: Array<{ id: string }> }
    const workflow = wfBody.data[0]
    test.skip(!workflow, 'No workflow available in the tenant to attach a trigger to')

    triggerWorkflowId = workflow!.id
    const res = await call(`/api/v1/workflows/${workflow!.id}/triggers`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'EVENT',
        eventType: eventTypeName,
        filter: { path: 'orderId', op: 'eq', value: 'o-e2e-1' },
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { id: string; eventType: string } }
    expect(body.data.eventType).toBe(eventTypeName)
    createdTriggerId = body.data.id
  })
})
