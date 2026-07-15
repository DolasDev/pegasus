import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import { setTunnelLambdaClient } from '../tunnel-client'
import { createPegiiApiClient, PegiiApiError, isPegiiNotFound } from '../pegii-api-client'

function fakeInvokePayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

/** Stub the underlying tunnel-proxy Lambda so tunnelFetch returns `upstream`. */
function stubUpstream(upstream: {
  status: number
  headers?: Record<string, string>
  body: string
}) {
  const send = vi.fn().mockResolvedValue({
    Payload: fakeInvokePayload({
      status: upstream.status,
      headers: upstream.headers ?? {},
      body: upstream.body,
    }),
  })
  setTunnelLambdaClient({ send } as unknown as LambdaClient)
  return send
}

beforeEach(() => {
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
})

afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('createPegiiApiClient.get', () => {
  it('builds the URL with query params and unwraps the { data } envelope', async () => {
    const send = stubUpstream({ status: 200, body: JSON.stringify({ data: { id: '42' } }) })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'https://10.200.7.1:8443' })

    const data = await client.get<{ id: string }>('/customers', {
      limit: 50,
      offset: 0,
      skip: undefined,
    })

    expect(data).toEqual({ id: '42' })
    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as Record<
      string,
      unknown
    >
    // undefined query values are dropped; defined ones are stringified.
    expect(payload['url']).toBe('https://10.200.7.1:8443/customers?limit=50&offset=0')
    expect(payload['method']).toBe('GET')
  })

  it('sends a Bearer header only when an apiKey is configured', async () => {
    const send = stubUpstream({ status: 200, body: JSON.stringify({ data: null }) })
    const client = createPegiiApiClient({
      tenantId: 't1',
      baseUrl: 'https://h',
      apiKey: 'secret-token',
    })
    await client.get('/x')

    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
      headers: Record<string, string>
    }
    expect(payload.headers['authorization']).toBe('Bearer secret-token')
  })

  it('fails fast with PEGII_API_NOT_CONFIGURED when baseUrl is empty (no tunnel hop)', async () => {
    const send = stubUpstream({ status: 200, body: '{"data":1}' })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: '' })

    await expect(client.get('/x')).rejects.toMatchObject({ code: 'PEGII_API_NOT_CONFIGURED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('maps a non-2xx { error, code } response to PEGII_API_HTTP_ERROR with status', async () => {
    stubUpstream({ status: 404, body: JSON.stringify({ error: 'gone', code: 'NOT_FOUND' }) })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'https://h' })

    const err = await client.get('/customers/nope').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PegiiApiError)
    expect(err).toMatchObject({ code: 'PEGII_API_HTTP_ERROR', status: 404 })
    expect(isPegiiNotFound(err)).toBe(true)
  })

  it('throws PEGII_API_BAD_ENVELOPE on a non-JSON body', async () => {
    stubUpstream({ status: 200, body: '<html>not json</html>' })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'https://h' })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'PEGII_API_BAD_ENVELOPE' })
  })

  it('throws PEGII_API_BAD_ENVELOPE when a 2xx body lacks a data field', async () => {
    stubUpstream({ status: 200, body: JSON.stringify({ notData: true }) })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'https://h' })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'PEGII_API_BAD_ENVELOPE' })
  })

  it('translates a TunnelError into PEGII_API_TUNNEL_ERROR', async () => {
    // No TUNNEL_PROXY_FUNCTION_NAME ⇒ tunnelFetch throws TunnelError.
    delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'https://h' })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'PEGII_API_TUNNEL_ERROR' })
  })
})

describe('createPegiiApiClient.getHealth', () => {
  it('returns the bare status body without requiring a { data } envelope', async () => {
    const send = stubUpstream({ status: 200, body: JSON.stringify({ status: 'healthy' }) })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://10.200.7.1:65274' })

    const health = await client.getHealth()

    expect(health).toEqual({ status: 'healthy' })
    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
      url: string
      method: string
    }
    expect(payload.url).toBe('http://10.200.7.1:65274/health')
    expect(payload.method).toBe('GET')
  })

  it('never sends an Authorization header even when an apiKey is configured (open endpoint)', async () => {
    const send = stubUpstream({ status: 200, body: JSON.stringify({ status: 'healthy' }) })
    const client = createPegiiApiClient({
      tenantId: 't1',
      baseUrl: 'http://h',
      apiKey: 'secret-token',
    })
    await client.getHealth()

    const cmd = send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
      headers: Record<string, string>
    }
    expect(payload.headers['authorization']).toBeUndefined()
  })

  it('fails fast with PEGII_API_NOT_CONFIGURED when baseUrl is empty', async () => {
    const send = stubUpstream({ status: 200, body: '{"status":"healthy"}' })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: '' })

    await expect(client.getHealth()).rejects.toMatchObject({ code: 'PEGII_API_NOT_CONFIGURED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('maps a non-2xx response to PEGII_API_HTTP_ERROR with status', async () => {
    stubUpstream({ status: 503, body: 'service unavailable' })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://h' })

    const err = await client.getHealth().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PegiiApiError)
    expect(err).toMatchObject({ code: 'PEGII_API_HTTP_ERROR', status: 503 })
  })

  it('throws PEGII_API_BAD_ENVELOPE on a non-JSON body', async () => {
    stubUpstream({ status: 200, body: '<html>not json</html>' })
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://h' })
    await expect(client.getHealth()).rejects.toMatchObject({ code: 'PEGII_API_BAD_ENVELOPE' })
  })

  it('translates a TunnelError into PEGII_API_TUNNEL_ERROR', async () => {
    delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://h' })
    await expect(client.getHealth()).rejects.toMatchObject({ code: 'PEGII_API_TUNNEL_ERROR' })
  })
})
