// ---------------------------------------------------------------------------
// Unit tests for adminFetch / adminFetchPaginated — x-correlation-id injection
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('@/config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.example.com' }),
}))

vi.mock('@/auth/cognito', () => ({
  getAccessToken: () => null,
}))

import { adminFetch, adminFetchPaginated } from '../api/client'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('adminFetch', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ data: 'ok' }), { status: 200 })),
      )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends an x-correlation-id header with a UUID', async () => {
    await adminFetch('/test')
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-correlation-id')).toMatch(UUID_RE)
  })

  it('generates a different correlation ID for each request', async () => {
    await adminFetch('/test')
    await adminFetch('/test')
    const h1 = new Headers((fetchSpy.mock.calls[0] as [string, RequestInit])[1]?.headers)
    const h2 = new Headers((fetchSpy.mock.calls[1] as [string, RequestInit])[1]?.headers)
    expect(h1.get('x-correlation-id')).not.toBe(h2.get('x-correlation-id'))
  })
})

describe('adminFetchPaginated', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [], meta: { total: 0, count: 0, limit: 50, offset: 0 } }),
          { status: 200 },
        ),
      )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends an x-correlation-id header with a UUID', async () => {
    await adminFetchPaginated('/tenants')
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-correlation-id')).toMatch(UUID_RE)
  })
})
