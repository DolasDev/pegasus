// ---------------------------------------------------------------------------
// @pegasus/api-http — ApiError + createApiClient factory tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, createApiClient, randomCorrelationId } from '../index'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function makeResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeClient(token: string | null = null) {
  return createApiClient({
    getBaseUrl: () => 'https://api.test',
    getToken: () => token,
  })
}

describe('ApiError', () => {
  it('stores message, code, and status', () => {
    const err = new ApiError('Not found', 'NOT_FOUND', 404)
    expect(err.message).toBe('Not found')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.status).toBe(404)
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('createApiClient().fetch', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns unwrapped data on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ data: { id: '1' } }))
    const client = makeClient()
    const result = await client.fetch<{ id: string }>('/moves/1')
    expect(result).toEqual({ id: '1' })
  })

  it('throws ApiError on error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404),
    )
    const client = makeClient()
    await expect(client.fetch('/moves/missing')).rejects.toBeInstanceOf(ApiError)
  })

  it('carries a Retry-After (delta seconds) on the ApiError when the server sends one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'starting', code: 'WORKFLOW_WORKER_STARTING' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '15' },
      }),
    )
    const err = (await makeClient()
      .fetch('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(503)
    expect(err.retryAfterSeconds).toBe(15)
  })

  it('leaves retryAfterSeconds undefined when the header is absent or not delta seconds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse({ error: 'x', code: 'X' }, 503))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'x', code: 'X' }), {
          status: 503,
          headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        }),
      )
    const client = makeClient()
    expect(
      ((await client.fetch('/a').catch((e: unknown) => e)) as ApiError).retryAfterSeconds,
    ).toBeUndefined()
    expect(
      ((await client.fetch('/b').catch((e: unknown) => e)) as ApiError).retryAfterSeconds,
    ).toBeUndefined()
  })

  it('returns null for 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const client = makeClient()
    const result = await client.fetch<null>('/moves/1')
    expect(result).toBeNull()
  })

  it('attaches x-correlation-id UUID on every call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ data: 'ok' }))
    const client = makeClient()
    await client.fetch('/test')
    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    const id = headers.get('x-correlation-id')
    expect(id).not.toBeNull()
    expect(UUID_REGEX.test(id!)).toBe(true)
  })

  it('generates a different UUID on each call', async () => {
    const ids: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers)
      ids.push(headers.get('x-correlation-id') ?? '')
      return makeResponse({ data: 'ok' })
    })
    const client = makeClient()
    await client.fetch('/a')
    await client.fetch('/b')
    expect(ids[0]).not.toBe(ids[1])
    expect(UUID_REGEX.test(ids[0]!)).toBe(true)
    expect(UUID_REGEX.test(ids[1]!)).toBe(true)
  })

  it('attaches Bearer token when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ data: 'ok' }))
    const client = makeClient('tok-abc')
    await client.fetch('/protected')
    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok-abc')
  })

  it('omits Authorization header when token is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ data: 'ok' }))
    const client = makeClient(null)
    await client.fetch('/public')
    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBeNull()
  })
})

describe('randomCorrelationId without a platform crypto.randomUUID (React Native / Hermes)', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('still returns a valid v4 UUID when crypto is undefined', () => {
    vi.stubGlobal('crypto', undefined)
    expect(UUID_REGEX.test(randomCorrelationId())).toBe(true)
  })

  it('still returns a valid v4 UUID when crypto lacks randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: () => new Uint8Array() })
    expect(UUID_REGEX.test(randomCorrelationId())).toBe(true)
  })

  it('does NOT throw and STILL sends the request when randomUUID is missing', async () => {
    // Regression: crypto.randomUUID() threw before fetch ran in RN, silently
    // killing every api-http request (mobile "No driver linked" bug).
    vi.stubGlobal('crypto', undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ data: 'ok' }))
    const client = makeClient()
    await expect(client.fetch('/me/driver')).resolves.toBe('ok')
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [, init] = fetchSpy.mock.calls[0]!
    const id = new Headers(init?.headers).get('x-correlation-id')
    expect(id).not.toBeNull()
    expect(UUID_REGEX.test(id!)).toBe(true)
  })

  it('prefers the native crypto.randomUUID when present', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    expect(randomCorrelationId()).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})

describe('createApiClient().fetchPaginated', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns data array and meta on success', async () => {
    const body = { data: [{ id: '1' }], meta: { total: 1, count: 1, limit: 50, offset: 0 } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(body))
    const client = makeClient()
    const result = await client.fetchPaginated<{ id: string }>('/moves')
    expect(result.data).toHaveLength(1)
    expect(result.meta.total).toBe(1)
  })

  it('throws ApiError on error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401),
    )
    const client = makeClient()
    await expect(client.fetchPaginated('/moves')).rejects.toBeInstanceOf(ApiError)
  })

  it('attaches x-correlation-id header', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        makeResponse({ data: [], meta: { total: 0, count: 0, limit: 50, offset: 0 } }),
      )
    const client = makeClient()
    await client.fetchPaginated('/moves')
    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    const id = headers.get('x-correlation-id')
    expect(id).not.toBeNull()
    expect(UUID_REGEX.test(id!)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// onUnauthorized — refresh once and retry on a 401 (mobile session refresh)
// ---------------------------------------------------------------------------

describe('createApiClient onUnauthorized', () => {
  beforeEach(() => vi.restoreAllMocks())

  const unauthorized = () =>
    Promise.resolve(makeResponse({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401))

  function authOf(call: unknown[]): string | null {
    return new Headers((call[1] as RequestInit).headers).get('Authorization')
  }

  function clientWith(onUnauthorized?: () => Promise<string | null>) {
    return createApiClient({
      getBaseUrl: () => 'https://api.test',
      getToken: () => 'old',
      ...(onUnauthorized ? { onUnauthorized } : {}),
    })
  }

  it('without the hook, a 401 throws as before (no retry)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(unauthorized)
    const err = (await clientWith()
      .fetch('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(401)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('on a 401, awaits the hook once and retries with the token it returns', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(unauthorized)
      .mockResolvedValueOnce(makeResponse({ data: { ok: true } }))
    const onUnauthorized = vi.fn(async () => 'fresh')
    await expect(
      clientWith(onUnauthorized).fetch('/x', { method: 'POST', body: '{}' }),
    ).resolves.toEqual({ ok: true })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(authOf(spy.mock.calls[0]!)).toBe('Bearer old')
    expect(authOf(spy.mock.calls[1]!)).toBe('Bearer fresh')
    expect((spy.mock.calls[1]![1] as RequestInit).method).toBe('POST')
    expect((spy.mock.calls[1]![1] as RequestInit).body).toBe('{}')
  })

  it('throws the original 401 when the hook returns null (refresh failed)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(unauthorized)
    const err = (await clientWith(async () => null)
      .fetch('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(401)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries only once — a second 401 throws without calling the hook again', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(unauthorized)
    const onUnauthorized = vi.fn(async () => 'fresh')
    const err = (await clientWith(onUnauthorized)
      .fetch('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(401)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not call the hook for non-401 errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({ error: 'Forbidden', code: 'FORBIDDEN' }, 403),
    )
    const onUnauthorized = vi.fn(async () => 'fresh')
    await expect(clientWith(onUnauthorized).fetch('/x')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('applies to fetchPaginated too', async () => {
    const body = { data: [{ id: '1' }], meta: { total: 1, count: 1, limit: 50, offset: 0 } }
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(unauthorized)
      .mockResolvedValueOnce(makeResponse(body))
    await expect(clientWith(async () => 'fresh').fetchPaginated('/x')).resolves.toEqual(body)
  })
})
