// ---------------------------------------------------------------------------
// Temporal Cloud Ops client — unit tests. No live calls: `fetch`, `sleep`,
// `now` and the logger are injected.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import {
  CLOUD_OPS_API_VERSION,
  CloudOpsAuthError,
  CloudOpsConflictError,
  CloudOpsError,
  CloudOpsOperationError,
  assertProvisionableName,
  createTemporalCloudOpsClient,
  tenantNamespaceName,
} from '../temporal-cloud-ops'

const API_KEY = 'provisioner-secret-key-xyz'
const MINTED_TOKEN = 'minted-tenant-token-abc'
const NS = 'pg-staging-a90b22bc4393'
const NS_ID = `${NS}.chgel`

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

function harness(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = []
  const queue = [...responses]
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const next = queue.shift()
    if (!next) throw new Error('unexpected fetch')
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
    })
  })
  const logged: unknown[] = []
  const log = {
    info: vi.fn((...args: unknown[]) => void logged.push(args)),
    warn: vi.fn((...args: unknown[]) => void logged.push(args)),
    error: vi.fn((...args: unknown[]) => void logged.push(args)),
  }
  let clock = 0
  const sleeps: number[] = []
  const client = createTemporalCloudOpsClient({
    apiKey: API_KEY,
    env: 'staging',
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    logger: log,
  })
  return { client, calls, logged, sleeps }
}

const op = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  state,
  check_duration: '2s',
  ...extra,
})

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe('tenantNamespaceName', () => {
  it('is pg-<env>-<first 12 hex of the tenant id>', () => {
    expect(tenantNamespaceName('staging', 'a90b22bc-4393-4ccc-8ddd-eeeeeeeeffff')).toBe(
      'pg-staging-a90b22bc4393',
    )
  })

  it('refuses a tenant id that is not a lowercase UUID', () => {
    expect(() => tenantNamespaceName('staging', 'not-a-uuid')).toThrow()
    expect(() => tenantNamespaceName('staging', 'A90B22BC-4393-4ccc-8ddd-eeeeeeeeffff')).toThrow()
  })
})

describe('assertProvisionableName', () => {
  it.each([NS, NS_ID])('accepts %s for its own env', (name) => {
    expect(() => assertProvisionableName('staging', name)).not.toThrow()
  })

  it.each([
    ['another env', 'pg-prod-a90b22bc4393'],
    ['another env (full id)', 'pg-prod-a90b22bc4393.chgel'],
    ['the platform namespace', 'pegasus-staging'],
    ['the platform namespace (full id)', 'pegasus-staging.chgel'],
    ['a short suffix', 'pg-staging-a90b22bc439'],
    ['a long suffix', 'pg-staging-a90b22bc43930'],
    ['uppercase hex', 'pg-staging-A90B22BC4393'],
    ['an env prefix trick', 'pg-staging-prod-a90b22bc4393'],
    ['a dotted suffix trick', 'pg-staging-a90b22bc4393.chgel.evil'],
    ['empty', ''],
  ])('refuses %s', (_label, name) => {
    expect(() => assertProvisionableName('staging', name)).toThrow(/not a provisionable/)
  })
})

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

describe('createTemporalCloudOpsClient — requests', () => {
  it('sends the bearer key and pins the API version', async () => {
    const { client, calls } = harness([
      { status: 200, body: { async_operation: op('o1', 'STATE_FULFILLED') } },
    ])
    await client.getOperation('o1')
    expect(calls[0]!.url).toBe('https://saas-api.tmprl.cloud/cloud/operations/o1')
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${API_KEY}`)
    expect(calls[0]!.headers['temporal-cloud-api-version']).toBe(CLOUD_OPS_API_VERSION)
    expect(CLOUD_OPS_API_VERSION).toBe('v0.23.0')
  })

  it('createNamespace posts an API-key-auth namespace spec', async () => {
    const { client, calls } = harness([
      { status: 200, body: { namespace: NS_ID, async_operation: op('op-1', 'STATE_PENDING') } },
    ])
    const out = await client.createNamespace({
      name: NS,
      retentionDays: 7,
      region: 'aws-us-east-1',
      asyncOperationId: 't:create_namespace:v1',
    })
    expect(out).toEqual({ namespace: NS_ID, asyncOperationId: 'op-1' })
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://saas-api.tmprl.cloud/cloud/namespaces',
      body: {
        spec: {
          name: NS,
          retention_days: 7,
          api_key_auth: { enabled: true },
          replicas: [{ region: 'aws-us-east-1' }],
        },
        async_operation_id: 't:create_namespace:v1',
      },
    })
  })

  it('getNamespace returns the resource version and gRPC endpoint, or null on 404', async () => {
    const { client } = harness([
      {
        status: 200,
        body: {
          namespace: {
            namespace: NS_ID,
            resource_version: 'rv-1',
            state: 'RESOURCE_STATE_ACTIVE',
            endpoints: { grpc_address: `${NS_ID}.tmprl.cloud:7233` },
          },
        },
      },
      { status: 404, body: { code: 5, message: 'not found' } },
    ])
    expect(await client.getNamespace(NS_ID)).toEqual({
      namespace: NS_ID,
      resourceVersion: 'rv-1',
      state: 'RESOURCE_STATE_ACTIVE',
      grpcAddress: `${NS_ID}.tmprl.cloud:7233`,
    })
    expect(await client.getNamespace(NS_ID)).toBeNull()
  })

  it('parses camelCase responses too (the gateway may emit either)', async () => {
    const { client } = harness([
      {
        status: 200,
        body: {
          serviceAccountId: 'sa-9',
          asyncOperation: { id: 'op-9', state: 'STATE_PENDING', checkDuration: '1s' },
        },
      },
    ])
    expect(
      await client.createScopedServiceAccount({
        name: `${NS}-writer`,
        namespace: NS_ID,
        asyncOperationId: 'x',
      }),
    ).toEqual({ serviceAccountId: 'sa-9', asyncOperationId: 'op-9' })
  })

  it('deleteNamespace sends the resource version as a query parameter', async () => {
    const { client, calls } = harness([
      { status: 200, body: { async_operation: op('op-2', 'STATE_PENDING') } },
    ])
    await client.deleteNamespace({
      namespace: NS_ID,
      resourceVersion: 'rv 1',
      asyncOperationId: 't:delete_namespace:v1',
    })
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(
      `https://saas-api.tmprl.cloud/cloud/namespaces/${NS_ID}?resource_version=rv+1&async_operation_id=t%3Adelete_namespace%3Av1`,
    )
  })

  it('createScopedServiceAccount asks for namespace-scoped Write only', async () => {
    const { client, calls } = harness([
      {
        status: 200,
        body: { service_account_id: 'sa-1', async_operation: op('op-3', 'STATE_PENDING') },
      },
    ])
    await client.createScopedServiceAccount({
      name: `${NS}-writer`,
      namespace: NS_ID,
      description: 'Tenant runner key',
      asyncOperationId: 't:create_service_account:v1',
    })
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://saas-api.tmprl.cloud/cloud/service-accounts',
      body: {
        spec: {
          name: `${NS}-writer`,
          description: 'Tenant runner key',
          namespace_scoped_access: {
            namespace: NS_ID,
            access: { permission: 'PERMISSION_WRITE' },
          },
        },
        async_operation_id: 't:create_service_account:v1',
      },
    })
    expect(calls[0]!.body).not.toHaveProperty('spec.access')
  })

  it('createApiKey returns the once-only token for a service-account owner', async () => {
    const { client, calls } = harness([
      {
        status: 200,
        body: {
          key_id: 'key-1',
          token: MINTED_TOKEN,
          async_operation: op('op-4', 'STATE_PENDING'),
        },
      },
    ])
    const out = await client.createApiKey({
      ownerId: 'sa-1',
      displayName: `${NS}-key`,
      expiryTime: new Date('2027-10-05T00:00:00.000Z'),
      asyncOperationId: 't:create_api_key:v1',
    })
    expect(out).toEqual({ keyId: 'key-1', token: MINTED_TOKEN, asyncOperationId: 'op-4' })
    expect(calls[0]!.body).toEqual({
      spec: {
        owner_id: 'sa-1',
        owner_type: 'OWNER_TYPE_SERVICE_ACCOUNT',
        display_name: `${NS}-key`,
        expiry_time: '2027-10-05T00:00:00.000Z',
      },
      async_operation_id: 't:create_api_key:v1',
    })
  })

  it('listApiKeys pages through the keys of one owner', async () => {
    const { client, calls } = harness([
      {
        status: 200,
        body: { api_keys: [{ id: 'k1', resource_version: 'r1' }], next_page_token: 'p2' },
      },
      { status: 200, body: { api_keys: [{ id: 'k2', resource_version: 'r2' }] } },
    ])
    expect(await client.listApiKeys('sa-1')).toEqual([
      { id: 'k1', resourceVersion: 'r1' },
      { id: 'k2', resourceVersion: 'r2' },
    ])
    expect(calls[0]!.url).toBe(
      'https://saas-api.tmprl.cloud/cloud/api-keys?owner_id=sa-1&owner_type=OWNER_TYPE_SERVICE_ACCOUNT',
    )
    expect(calls[1]!.url).toContain('page_token=p2')
  })

  it('findServiceAccountByName pages and matches the exact name', async () => {
    const { client } = harness([
      {
        status: 200,
        body: {
          service_account: [{ id: 'sa-0', spec: { name: `${NS}-writer-old` } }],
          next_page_token: 'p2',
        },
      },
      { status: 200, body: { service_account: [{ id: 'sa-1', spec: { name: `${NS}-writer` } }] } },
    ])
    expect(await client.findServiceAccountByName(`${NS}-writer`)).toEqual({ id: 'sa-1' })
  })

  it('deleteApiKey sends DELETE with the resource version', async () => {
    const { client, calls } = harness([
      { status: 200, body: { async_operation: op('op-5', 'STATE_PENDING') } },
    ])
    expect(
      await client.deleteApiKey({ keyId: 'key-1', resourceVersion: 'r1', asyncOperationId: 'd1' }),
    ).toEqual({ asyncOperationId: 'op-5' })
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(
      'https://saas-api.tmprl.cloud/cloud/api-keys/key-1?resource_version=r1&async_operation_id=d1',
    )
  })

  it('getApiKey returns the resource version, or null on 404', async () => {
    const { client } = harness([
      { status: 200, body: { api_key: { id: 'key-1', resource_version: 'r1' } } },
      { status: 404, body: {} },
    ])
    expect(await client.getApiKey('key-1')).toEqual({ id: 'key-1', resourceVersion: 'r1' })
    expect(await client.getApiKey('key-1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The name guard runs before any mutating call reaches the network
// ---------------------------------------------------------------------------

describe('createTemporalCloudOpsClient — name guard', () => {
  it.each([
    [
      'createNamespace',
      (c: ReturnType<typeof harness>['client']) =>
        c.createNamespace({
          name: 'pegasus-staging',
          retentionDays: 7,
          region: 'r',
          asyncOperationId: 'x',
        }),
    ],
    [
      'deleteNamespace',
      (c: ReturnType<typeof harness>['client']) =>
        c.deleteNamespace({
          namespace: 'pegasus-prod.chgel',
          resourceVersion: 'r',
          asyncOperationId: 'x',
        }),
    ],
    [
      'createScopedServiceAccount',
      (c: ReturnType<typeof harness>['client']) =>
        c.createScopedServiceAccount({
          name: 'n',
          namespace: 'pg-prod-a90b22bc4393.chgel',
          asyncOperationId: 'x',
        }),
    ],
  ])('%s refuses a foreign namespace without calling fetch', async (_label, call) => {
    const h = harness([])
    await expect(call(h.client)).rejects.toThrow(/not a provisionable/)
    expect(h.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('createTemporalCloudOpsClient — errors', () => {
  it.each([401, 403])('maps %i to CloudOpsAuthError', async (status) => {
    const { client } = harness([{ status, body: { message: 'denied' } }])
    await expect(client.getOperation('o')).rejects.toBeInstanceOf(CloudOpsAuthError)
  })

  it('maps 409 to CloudOpsConflictError', async () => {
    const { client } = harness([{ status: 409, body: { message: 'resource version mismatch' } }])
    await expect(client.getOperation('o')).rejects.toBeInstanceOf(CloudOpsConflictError)
  })

  it('maps other failures to CloudOpsError with status and message, never the key', async () => {
    const { client } = harness([{ status: 500, body: { message: 'internal' } }])
    const err = await client.getOperation('o').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CloudOpsError)
    expect((err as CloudOpsError).status).toBe(500)
    expect((err as Error).message).toContain('internal')
    expect((err as Error).message).not.toContain(API_KEY)
  })
})

// ---------------------------------------------------------------------------
// Async operations
// ---------------------------------------------------------------------------

describe('waitForOperation', () => {
  it('polls, honouring check_duration, until fulfilled', async () => {
    const { client, sleeps } = harness([
      {
        status: 200,
        body: { async_operation: op('o', 'STATE_PENDING', { check_duration: '3s' }) },
      },
      {
        status: 200,
        body: { async_operation: op('o', 'STATE_IN_PROGRESS', { check_duration: '0.5s' }) },
      },
      { status: 200, body: { async_operation: op('o', 'STATE_FULFILLED') } },
    ])
    await expect(client.waitForOperation('o', { timeoutMs: 60_000 })).resolves.toMatchObject({
      state: 'STATE_FULFILLED',
    })
    expect(sleeps).toEqual([3000, 1000])
  })

  it('caps a missing or huge check_duration', async () => {
    const { client, sleeps } = harness([
      { status: 200, body: { async_operation: { id: 'o', state: 'STATE_PENDING' } } },
      {
        status: 200,
        body: { async_operation: op('o', 'STATE_PENDING', { check_duration: '3600s' }) },
      },
      { status: 200, body: { async_operation: op('o', 'STATE_FULFILLED') } },
    ])
    await client.waitForOperation('o', { timeoutMs: 600_000 })
    expect(sleeps).toEqual([2000, 30_000])
  })

  it.each(['STATE_FAILED', 'STATE_CANCELLED', 'STATE_REJECTED'])(
    'throws CloudOpsOperationError on %s with the failure reason',
    async (state) => {
      const { client } = harness([
        { status: 200, body: { async_operation: op('o', state, { failure_reason: 'quota' }) } },
      ])
      const err = await client.waitForOperation('o', { timeoutMs: 1000 }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CloudOpsOperationError)
      expect((err as Error).message).toContain('quota')
    },
  )

  it('gives up after the timeout', async () => {
    const pending = {
      status: 200,
      body: { async_operation: op('o', 'STATE_PENDING', { check_duration: '10s' }) },
    }
    const { client } = harness([pending, pending, pending, pending])
    await expect(client.waitForOperation('o', { timeoutMs: 25_000 })).rejects.toThrow(/timed out/)
  })
})

// ---------------------------------------------------------------------------
// Secrets never reach the logger
// ---------------------------------------------------------------------------

describe('logging', () => {
  it('never logs the provisioner key or a minted token, on success or failure', async () => {
    const { client, logged } = harness([
      {
        status: 200,
        body: { key_id: 'key-1', token: MINTED_TOKEN, async_operation: op('op', 'STATE_PENDING') },
      },
      { status: 500, body: { message: 'boom' } },
    ])
    await client.createApiKey({
      ownerId: 'sa-1',
      displayName: 'd',
      expiryTime: new Date('2027-01-01T00:00:00.000Z'),
      asyncOperationId: 'a',
    })
    await client.getOperation('o').catch(() => {})

    expect(logged.length).toBeGreaterThan(0)
    const text = JSON.stringify(logged)
    expect(text).not.toContain(API_KEY)
    expect(text).not.toContain(MINTED_TOKEN)
  })

  it('marks mutations as audit events', async () => {
    const { client, logged } = harness([
      { status: 200, body: { namespace: NS_ID, async_operation: op('op-1', 'STATE_PENDING') } },
    ])
    await client.createNamespace({
      name: NS,
      retentionDays: 7,
      region: 'r',
      asyncOperationId: 'a1',
    })
    expect(logged).toContainEqual([
      'temporal_cloud_ops.request',
      expect.objectContaining({
        audit: true,
        method: 'POST',
        path: '/cloud/namespaces',
        status: 200,
      }),
    ])
  })
})
