// ---------------------------------------------------------------------------
// withTemporalClient — per-namespace clients for cut-over tenants (3b.2).
//
// Runs against FakeTemporalCloud, which enforces the refusals the real service
// does (3b.1 lesson: #844 and #845 shipped because a fake allowed what Temporal
// Cloud refuses):
//   * a namespace-scoped key is refused on any other namespace;
//   * a retired key is refused (PERMISSION_DENIED) everywhere;
//   * the code can re-fetch a newer key and succeed.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Client } from '@temporalio/client'
import {
  _setTemporalClientForTesting,
  _setTenantTemporalDepsForTesting,
  isTemporalAuthError,
  TENANT_CLIENT_TTL_MS,
  TenantTemporalKeyUnavailableError,
  withTemporalClient,
} from '../temporal-client'
import type { DecryptedTemporalKey } from '../../repositories/tenant-temporal-namespace.repository'

const TENANT = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const OTHER_TENANT = '11111111-2222-4333-8444-555555555555'
const NS = 'pg-test-0f1e2d3c4b5a.acct'
const OTHER_NS = 'pg-test-111111112222.acct'
const SHARED_NS = 'pegasus-test.acct'

/** A grpc-js style service error, as @temporalio/client surfaces it (wrapped). */
function refusal(code: number, message: string): Error {
  const grpc = Object.assign(new Error(`${code} ${message}`), {
    code,
    details: message,
    metadata: {},
  })
  // The client wraps gRPC failures in a ServiceError whose cause is the gRPC error.
  return new Error(`ServiceError: ${message}`, { cause: grpc })
}

/** Temporal Cloud's key rules, in memory. */
class FakeTemporalCloud {
  /** apiKey → the one namespace it is scoped to, while it is live. */
  private readonly keys = new Map<string, string>()
  readonly calls: Array<{ apiKey: string; namespace: string; op: string }> = []

  mint(apiKey: string, namespace: string): void {
    this.keys.set(apiKey, namespace)
  }

  retire(apiKey: string): void {
    this.keys.delete(apiKey)
  }

  authorize(apiKey: string, namespace: string, op: string): void {
    this.calls.push({ apiKey, namespace, op })
    const scope = this.keys.get(apiKey)
    if (scope === undefined) throw refusal(16, 'API key is invalid or has been deleted')
    if (scope !== namespace) {
      throw refusal(7, `Request unauthorized: key not authorized for namespace ${namespace}`)
    }
  }

  /** A connector that hands out fake clients bound to (key, namespace). */
  connect = vi.fn(async (key: DecryptedTemporalKey) => {
    const close = vi.fn(async () => {})
    const authorize = (op: string) => this.authorize(key.apiKey, key.namespace, op)
    const client = {
      workflow: {
        start: async (name: string) => {
          authorize('start')
          return { workflowId: `wf-${name}`, firstExecutionRunId: 'run-1' }
        },
        getHandle: (workflowId: string) => ({
          describe: async () => {
            authorize('describe')
            return { workflowId }
          },
        }),
      },
    } as unknown as Client
    return { client, close }
  })
}

let cloud: FakeTemporalCloud
let currentKey: DecryptedTemporalKey | null
let now: number
const loadKey = vi.fn(async (_tenantId: string) => currentKey)

function keyFor(apiKey: string, namespace = NS): DecryptedTemporalKey {
  return { namespace, grpcAddress: `${namespace}.tmprl.cloud:7233`, apiKeyId: apiKey, apiKey }
}

const start = (namespace: string | null, tenantId = TENANT) =>
  withTemporalClient({ tenantId, namespace }, (c) => c.workflow.start('wf', {} as never))

beforeEach(() => {
  process.env['TEMPORAL_NAMESPACE'] = SHARED_NS
  cloud = new FakeTemporalCloud()
  cloud.mint('key-1', NS)
  currentKey = keyFor('key-1')
  now = 1_000_000
  loadKey.mockClear()
  _setTenantTemporalDepsForTesting({ loadKey, connect: cloud.connect, now: () => now })
})

afterEach(() => {
  _setTenantTemporalDepsForTesting(null)
  _setTemporalClientForTesting(null)
  delete process.env['TEMPORAL_NAMESPACE']
})

describe('the fake enforces the real refusals (guards the guard)', () => {
  it('refuses a scoped key on another namespace, and a retired key anywhere', () => {
    expect(() => cloud.authorize('key-1', OTHER_NS, 'start')).toThrow(/not authorized/)
    cloud.retire('key-1')
    expect(() => cloud.authorize('key-1', NS, 'start')).toThrow(/invalid or has been deleted/)
  })
})

describe('withTemporalClient', () => {
  it('uses the shared client for a null namespace and for the platform namespace itself', async () => {
    const shared = { workflow: { start: vi.fn(async () => 'shared') } } as unknown as Client
    _setTemporalClientForTesting(shared)

    expect(await start(null)).toBe('shared')
    expect(await start(SHARED_NS)).toBe('shared')
    expect(loadKey).not.toHaveBeenCalled()
    expect(cloud.connect).not.toHaveBeenCalled()
  })

  it('connects to a tenant namespace with that tenant’s key, at the row’s address', async () => {
    await start(NS)
    expect(loadKey).toHaveBeenCalledWith(TENANT)
    expect(cloud.connect).toHaveBeenCalledWith(keyFor('key-1'))
    expect(cloud.calls).toEqual([{ apiKey: 'key-1', namespace: NS, op: 'start' }])
  })

  it('refuses to use a tenant’s key for a namespace it does not belong to', async () => {
    // The row names another tenant's namespace (a bug): never connect.
    await expect(start(OTHER_NS)).rejects.toThrow(/belongs to .* not pg-test-111111112222/)
    expect(cloud.connect).not.toHaveBeenCalled()
  })

  it('throws TenantTemporalKeyUnavailableError when the tenant has no key', async () => {
    currentKey = null
    await expect(start(NS)).rejects.toBeInstanceOf(TenantTemporalKeyUnavailableError)
  })

  it('caches one client per namespace for the TTL, then re-reads the key', async () => {
    await start(NS)
    await start(NS)
    expect(loadKey).toHaveBeenCalledTimes(1)

    now += TENANT_CLIENT_TTL_MS + 1
    await start(NS)
    expect(loadKey).toHaveBeenCalledTimes(2)
    // The expired client's connection was closed.
    const first = await cloud.connect.mock.results[0]!.value
    expect(first.close).toHaveBeenCalled()
  })

  it('rotation: a retired key in a warm cache is evicted, re-fetched and the call retried once', async () => {
    await start(NS) // warms the cache with key-1

    // The provisioner rotates: key-2 becomes current, key-1 is retired 24 h later.
    cloud.mint('key-2', NS)
    currentKey = keyFor('key-2')
    cloud.retire('key-1')

    await expect(start(NS)).resolves.toEqual({ workflowId: 'wf-wf', firstExecutionRunId: 'run-1' })
    expect(cloud.calls.map((c) => [c.apiKey, c.op])).toEqual([
      ['key-1', 'start'],
      ['key-1', 'start'], // refused
      ['key-2', 'start'], // retried on the fresh key
    ])
    expect(loadKey).toHaveBeenCalledTimes(2)
  })

  it('a second auth refusal propagates (no retry loop)', async () => {
    await start(NS)
    cloud.retire('key-1') // and no new key was minted: the DB still serves key-1

    await expect(start(NS)).rejects.toSatisfy(isTemporalAuthError)
    expect(cloud.calls.filter((c) => c.op === 'start')).toHaveLength(3)
  })

  it('does not retry a non-auth failure', async () => {
    const boom = new Error('workflow already started')
    await expect(
      withTemporalClient({ tenantId: TENANT, namespace: NS }, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(loadKey).toHaveBeenCalledTimes(1)
  })

  it('keeps tenants apart: each namespace gets its own tenant’s key', async () => {
    cloud.mint('other-key', OTHER_NS)
    loadKey.mockImplementation(async (tenantId) =>
      tenantId === TENANT ? keyFor('key-1') : keyFor('other-key', OTHER_NS),
    )
    await start(NS, TENANT)
    await start(OTHER_NS, OTHER_TENANT)
    expect(cloud.calls).toEqual([
      { apiKey: 'key-1', namespace: NS, op: 'start' },
      { apiKey: 'other-key', namespace: OTHER_NS, op: 'start' },
    ])
  })
})

describe('isTemporalAuthError', () => {
  it('finds PERMISSION_DENIED / UNAUTHENTICATED anywhere in the cause chain', () => {
    expect(isTemporalAuthError(refusal(7, 'denied'))).toBe(true)
    expect(isTemporalAuthError(refusal(16, 'unauthenticated'))).toBe(true)
  })

  it('is false for other gRPC codes and plain errors', () => {
    expect(isTemporalAuthError(refusal(5, 'not found'))).toBe(false)
    expect(isTemporalAuthError(new Error('boom'))).toBe(false)
    expect(isTemporalAuthError(undefined)).toBe(false)
  })
})
