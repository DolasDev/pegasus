// ---------------------------------------------------------------------------
// @pegasus/api-http — ApiError + createApiClient factory tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, createApiClient } from '../index'

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
