// ---------------------------------------------------------------------------
// Unit tests for the cloud → on-prem proxy handler.
//
// Stubs the LambdaClient inside tunnel-client so no AWS SDK calls happen,
// and mocks the per-tenant VpnPeer lookup so URL construction is observable.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import type { AppEnv } from '../types'
import { setTunnelLambdaClient } from '../lib/tunnel-client'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vpnPeer: {
      findUnique: vi.fn(),
    },
  },
}))

import { onpremHandler } from './onprem'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('correlationId', 'corr-test')
    c.set('tenantId', 'tnt_smoke')
    c.set('userId', 'user-test')
    c.set('role', 'tenant_admin')
    // @ts-expect-error mocked Prisma client — only vpnPeer.findUnique is exercised
    c.set('db', mockDb)
    await next()
  })
  app.route('/api/v1/onprem', onpremHandler)
  return app
}

function fakeInvokePayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-tunnel-proxy'
  delete process.env['ONPREM_TUNNEL_BASE_OVERRIDE']
  delete process.env['ONPREM_TUNNEL_PORT']
  delete process.env['ONPREM_TUNNEL_SCHEME']
  delete process.env['ONPREM_API_KEY']
})

afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('GET /api/v1/onprem/longhaul/version', () => {
  it('routes through the tunnel using the tenant overlay IP and forwards upstream JSON', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 7,
      assignedOctet2: 4,
      status: 'ACTIVE',
    })
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data":{"version":"1.2.3"}}',
      }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { version: '1.2.3' } })

    expect(send).toHaveBeenCalledOnce()
    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as Record<
      string,
      unknown
    >
    expect(payload['method']).toBe('GET')
    expect(payload['url']).toBe('http://10.200.7.4:3000/api/v1/longhaul/version')
  })

  it('forwards Authorization header when ONPREM_API_KEY is set', async () => {
    process.env['ONPREM_API_KEY'] = 'vnd_smoke_test_key'
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'ACTIVE',
    })
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{"data":null}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/version')

    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
      headers: Record<string, string>
    }
    expect(payload.headers['authorization']).toBe('Bearer vnd_smoke_test_key')
  })

  it('omits the Authorization header when ONPREM_API_KEY is not set', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'ACTIVE',
    })
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/version')

    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
      headers: Record<string, string>
    }
    expect(payload.headers['authorization']).toBeUndefined()
  })

  it('honours ONPREM_TUNNEL_BASE_OVERRIDE and skips the VpnPeer lookup', async () => {
    process.env['ONPREM_TUNNEL_BASE_OVERRIDE'] = 'http://10.200.9.9:8080'
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(mockDb.vpnPeer.findUnique).not.toHaveBeenCalled()
    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as { url: string }
    expect(payload.url).toBe('http://10.200.9.9:8080/api/v1/longhaul/version')
  })

  it('returns 503 when the tenant has no VpnPeer', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('TUNNEL_NO_PEER')
  })

  it('returns 503 when the peer is not ACTIVE', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'PENDING',
    })

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('TUNNEL_PEER_INACTIVE')
  })

  it('returns 503 when TUNNEL_PROXY_FUNCTION_NAME is unset', async () => {
    delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'ACTIVE',
    })

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('TUNNEL_NOT_CONFIGURED')
  })

  it('returns 502 when the tunnel-proxy Lambda raises a FunctionError', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'ACTIVE',
    })
    const send = vi.fn().mockResolvedValue({
      FunctionError: 'Unhandled',
      Payload: fakeInvokePayload({ errorMessage: 'boom' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(502)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('TUNNEL_PROXY_ERROR')
  })

  it('passes upstream non-2xx status through unchanged', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 0,
      assignedOctet2: 2,
      status: 'ACTIVE',
    })
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: '{"error":"nope"}',
      }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request('/api/v1/onprem/longhaul/version')

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error":"nope"}')
  })
})

describe('wildcard /api/v1/onprem/longhaul/* proxy', () => {
  function activePeer() {
    mockDb.vpnPeer.findUnique.mockResolvedValue({
      assignedOctet1: 5,
      assignedOctet2: 8,
      status: 'ACTIVE',
    })
  }

  function lastInvokePayload(send: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    return JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as Record<string, unknown>
  }

  it('forwards GET with query string preserved on a non-/version path', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '[]',
      }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request(
      '/api/v1/onprem/longhaul/trips?filters=%7B%22a%22%3A1%7D&searchTerm=foo',
    )

    expect(res.status).toBe(200)
    const payload = lastInvokePayload(send)
    expect(payload['method']).toBe('GET')
    expect(payload['url']).toBe(
      'http://10.200.5.8:3000/api/v1/longhaul/trips?filters=%7B%22a%22%3A1%7D&searchTerm=foo',
    )
  })

  it('forwards reference-data GETs without trailing query string', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '[]' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/states')

    const payload = lastInvokePayload(send)
    expect(payload['method']).toBe('GET')
    expect(payload['url']).toBe('http://10.200.5.8:3000/api/v1/longhaul/states')
  })

  it('forwards POST body, method, and content-type on a nested path', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: '{"id":99}',
      }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request('/api/v1/onprem/longhaul/trips/42/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'hello', type: 'driver' }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 99 })

    const payload = lastInvokePayload(send) as {
      method: string
      url: string
      body: string
      headers: Record<string, string>
    }
    expect(payload.method).toBe('POST')
    expect(payload.url).toBe('http://10.200.5.8:3000/api/v1/longhaul/trips/42/notes')
    expect(payload.body).toBe('{"note":"hello","type":"driver"}')
    expect(payload.headers['content-type']).toBe('application/json')
  })

  it('forwards PATCH on a deep nested path', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/trips/42/status', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statusId: 3 }),
    })

    const payload = lastInvokePayload(send) as {
      method: string
      url: string
      body: string
    }
    expect(payload.method).toBe('PATCH')
    expect(payload.url).toBe('http://10.200.5.8:3000/api/v1/longhaul/trips/42/status')
    expect(payload.body).toBe('{"statusId":3}')
  })

  it('forwards DELETE without a body', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 204, headers: {}, body: '' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await buildApp().request('/api/v1/onprem/longhaul/shipment-filters/7', {
      method: 'DELETE',
    })

    expect(res.status).toBe(204)
    const payload = lastInvokePayload(send) as {
      method: string
      url: string
      body: string
    }
    expect(payload.method).toBe('DELETE')
    expect(payload.url).toBe('http://10.200.5.8:3000/api/v1/longhaul/shipment-filters/7')
    expect(payload.body).toBe('')
  })

  it('does NOT forward inbound cookie / x-forwarded-for / authorization headers', async () => {
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/drivers', {
      headers: {
        cookie: 'session=leak-me',
        'x-forwarded-for': '203.0.113.7',
        authorization: 'Bearer caller-token-should-not-be-forwarded',
      },
    })

    const payload = lastInvokePayload(send) as { headers: Record<string, string> }
    expect(payload.headers['cookie']).toBeUndefined()
    expect(payload.headers['x-forwarded-for']).toBeUndefined()
    // Authorization is only present when ONPREM_API_KEY is set; here it isn't.
    expect(payload.headers['authorization']).toBeUndefined()
  })

  it('synthesises the bearer token on non-GET methods when ONPREM_API_KEY is set', async () => {
    process.env['ONPREM_API_KEY'] = 'k_post_test'
    activePeer()
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: '{}' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await buildApp().request('/api/v1/onprem/longhaul/activities/9', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    const payload = lastInvokePayload(send) as { headers: Record<string, string> }
    expect(payload.headers['authorization']).toBe('Bearer k_post_test')
  })
})
