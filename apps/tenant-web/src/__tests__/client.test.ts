// ---------------------------------------------------------------------------
// Unit tests for apiFetch — x-correlation-id header injection
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('../config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.example.com' }),
}))

vi.mock('../auth/session', () => ({
  getSession: () => null,
}))

import { apiFetch } from '../api/client'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('apiFetch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

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

  it('sends an x-correlation-id header with a UUID on every request', async () => {
    await apiFetch('/test')
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init?.headers as HeadersInit)
    expect(headers.get('x-correlation-id')).toMatch(UUID_RE)
  })

  it('generates a different correlation ID for each request', async () => {
    await apiFetch('/test')
    await apiFetch('/test')
    const id1 = new Headers(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1]?.headers as HeadersInit,
    ).get('x-correlation-id')
    const id2 = new Headers(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1]?.headers as HeadersInit,
    ).get('x-correlation-id')
    expect(id1).not.toBe(id2)
  })
})
