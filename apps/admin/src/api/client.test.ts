// ---------------------------------------------------------------------------
// adminFetch / adminFetchPaginated client tests — correlation ID injection
//
// Verifies that every outgoing API call attaches a fresh x-correlation-id
// header. Dependencies (getConfig, getAccessToken, fetch) are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminFetch, adminFetchPaginated } from './client'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

vi.mock('@/config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.test' }),
}))

vi.mock('@/auth/cognito', () => ({
  getAccessToken: () => null,
}))

function makeOkResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('adminFetch — x-correlation-id header', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches an x-correlation-id header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeOkResponse({ data: 'ok' }))

    await adminFetch('/test')

    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers((init as RequestInit | undefined)?.headers)
    const id = headers.get('x-correlation-id')
    expect(id).not.toBeNull()
    expect(UUID_REGEX.test(id!)).toBe(true)
  })

  it('generates a different UUID on each call', async () => {
    const ids: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers)
      ids.push(headers.get('x-correlation-id') ?? '')
      return makeOkResponse({ data: 'ok' })
    })

    await adminFetch('/a')
    await adminFetch('/b')

    expect(ids[0]).not.toBe(ids[1])
    expect(UUID_REGEX.test(ids[0]!)).toBe(true)
    expect(UUID_REGEX.test(ids[1]!)).toBe(true)
  })
})

describe('adminFetchPaginated — x-correlation-id header', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches an x-correlation-id header', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        makeOkResponse({ data: [], meta: { total: 0, count: 0, limit: 50, offset: 0 } }),
      )

    await adminFetchPaginated('/tenants')

    const [, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers((init as RequestInit | undefined)?.headers)
    const id = headers.get('x-correlation-id')
    expect(id).not.toBeNull()
    expect(UUID_REGEX.test(id!)).toBe(true)
  })

  it('generates a different UUID on each call', async () => {
    const ids: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers)
      ids.push(headers.get('x-correlation-id') ?? '')
      return makeOkResponse({ data: [], meta: { total: 0, count: 0, limit: 50, offset: 0 } })
    })

    await adminFetchPaginated('/tenants?limit=10')
    await adminFetchPaginated('/tenants?limit=20')

    expect(ids[0]).not.toBe(ids[1])
    expect(UUID_REGEX.test(ids[0]!)).toBe(true)
    expect(UUID_REGEX.test(ids[1]!)).toBe(true)
  })
})
