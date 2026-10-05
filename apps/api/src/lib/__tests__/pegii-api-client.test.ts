import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import { setTunnelLambdaClient } from '../tunnel-client'
import {
  createPegiiApiClient,
  PegiiApiError,
  isPegiiNotFound,
  pegiiApiErrorToHttp,
} from '../pegii-api-client'

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

describe('pegiiApiErrorToHttp', () => {
  it("maps the site's COMPANY_NOT_FOUND to its own 404, and never as a record not-found", () => {
    const err = new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 404, 'COMPANY_NOT_FOUND')
    expect(pegiiApiErrorToHttp(err)).toMatchObject({ status: 404, code: 'COMPANY_NOT_FOUND' })
    expect(isPegiiNotFound(err)).toBe(false)
  })

  it('maps COMPANY_SCHEMA_UNAVAILABLE to 503 with its own code', () => {
    expect(
      pegiiApiErrorToHttp(
        new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 503, 'COMPANY_SCHEMA_UNAVAILABLE'),
      ),
    ).toMatchObject({ status: 503, code: 'COMPANY_SCHEMA_UNAVAILABLE' })
  })

  it('maps NOT_CONFIGURED to 503 PEGII_SOURCE_UNAVAILABLE', () => {
    expect(pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'x'))).toMatchObject({
      status: 503,
      code: 'PEGII_SOURCE_UNAVAILABLE',
    })
  })

  it('maps TUNNEL_ERROR to 502 PEGII_SOURCE_UNREACHABLE, carrying the detail', () => {
    const out = pegiiApiErrorToHttp(
      new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'connect timed out'),
    )
    expect(out.status).toBe(502)
    expect(out.code).toBe('PEGII_SOURCE_UNREACHABLE')
    expect(out.message).toMatch(/connect timed out/)
  })

  it('maps BAD_ENVELOPE to 502 PEGII_SOURCE_BAD_RESPONSE', () => {
    expect(
      pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_BAD_ENVELOPE', 'no data', 200)),
    ).toMatchObject({ status: 502, code: 'PEGII_SOURCE_BAD_RESPONSE' })
  })

  it('maps an upstream 404 HTTP_ERROR to 404 NOT_FOUND', () => {
    expect(
      pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_HTTP_ERROR', 'not found', 404)),
    ).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('maps a non-404 upstream HTTP_ERROR to 502 PEGII_SOURCE_BAD_RESPONSE', () => {
    expect(
      pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_HTTP_ERROR', 'boom', 500)),
    ).toMatchObject({ status: 502, code: 'PEGII_SOURCE_BAD_RESPONSE' })
  })
})

/** Stub the tunnel with a sequence of upstream responses, one per call. */
function stubSequence(responses: Array<{ status: number; body: string }>) {
  const send = vi.fn()
  for (const r of responses) {
    send.mockResolvedValueOnce({
      Payload: fakeInvokePayload({ status: r.status, headers: {}, body: r.body }),
    })
  }
  setTunnelLambdaClient({ send } as unknown as LambdaClient)
  return send
}

const sentPayload = (send: ReturnType<typeof vi.fn>, i: number) => {
  const cmd = send.mock.calls[i]![0] as { input: { Payload: Uint8Array } }
  return JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as {
    method: string
    url: string
    body?: string
    headers: Record<string, string>
  }
}

describe('createPegiiApiClient.post / put', () => {
  it('POSTs a JSON body and unwraps { data }', async () => {
    const send = stubSequence([{ status: 200, body: JSON.stringify({ data: { sent: true } }) }])
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://10.200.7.1:65274' })
    expect(await client.post('/api/v1/pegii/email/send', { to: ['a@b.test'] })).toEqual({
      sent: true,
    })
    const p = sentPayload(send, 0)
    expect(p.method).toBe('POST')
    expect(JSON.parse(p.body!)).toEqual({ to: ['a@b.test'] })
    expect(p.headers['content-type']).toBe('application/json')
  })

  it('PUTs with the same contract', async () => {
    const send = stubSequence([{ status: 200, body: JSON.stringify({ data: 1 }) }])
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://x' })
    await client.put('/p', { a: 1 })
    expect(sentPayload(send, 0).method).toBe('PUT')
  })

  it('carries pegII’s own error code on a 409', async () => {
    stubSequence([
      { status: 409, body: JSON.stringify({ error: 'dup', code: 'IDEMPOTENCY_KEY_REUSED' }) },
    ])
    const client = createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://x' })
    await expect(client.post('/p', {})).rejects.toMatchObject({
      code: 'PEGII_API_HTTP_ERROR',
      status: 409,
      upstreamCode: 'IDEMPOTENCY_KEY_REUSED',
    })
  })
})

describe('createPegiiApiClient with a service-user token provider', () => {
  const provider = () => {
    let n = 0
    return { getToken: vi.fn(async () => `tok-${++n}`), invalidate: vi.fn() }
  }

  it('sends the provider’s token as a bearer', async () => {
    const send = stubSequence([{ status: 200, body: JSON.stringify({ data: {} }) }])
    const auth = provider()
    await createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://x', auth }).get('/p')
    expect(sentPayload(send, 0).headers['authorization']).toBe('Bearer tok-1')
  })

  it('on 401 invalidates, logs in again and retries once', async () => {
    const send = stubSequence([
      { status: 401, body: '' },
      { status: 200, body: JSON.stringify({ data: 'ok' }) },
    ])
    const auth = provider()
    const out = await createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://x', auth }).get('/p')
    expect(out).toBe('ok')
    expect(auth.invalidate).toHaveBeenCalledTimes(1)
    expect(sentPayload(send, 1).headers['authorization']).toBe('Bearer tok-2')
  })

  it('gives up with PEGII_API_AUTH_FAILED when the fresh token is rejected too', async () => {
    stubSequence([
      { status: 401, body: '' },
      { status: 401, body: '' },
    ])
    const auth = provider()
    await expect(
      createPegiiApiClient({ tenantId: 't1', baseUrl: 'http://x', auth }).get('/p'),
    ).rejects.toMatchObject({ code: 'PEGII_API_AUTH_FAILED', status: 401 })
  })
})

describe('pegiiApiErrorToHttp — new cases', () => {
  it('passes 400/409/422 through with pegII’s code', () => {
    expect(
      pegiiApiErrorToHttp(
        new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 409, 'IDEMPOTENCY_KEY_REUSED'),
      ),
    ).toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 400))).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    })
    expect(
      pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 422, 'ORDER_CLOSED')),
    ).toMatchObject({ status: 422, code: 'ORDER_CLOSED' })
  })

  it('maps auth and capability failures to named 502/503s', () => {
    expect(pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_AUTH_FAILED', 'x'))).toMatchObject({
      status: 502,
      code: 'PEGII_SOURCE_AUTH_FAILED',
    })
    expect(pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_AUTH_UNAVAILABLE', 'x'))).toMatchObject(
      {
        status: 503,
        code: 'PEGII_AUTH_UNAVAILABLE',
      },
    )
    expect(
      pegiiApiErrorToHttp(new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'x')),
    ).toMatchObject({ status: 503, code: 'PEGII_CAPABILITY_MISSING' })
  })
})
