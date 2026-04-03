// ---------------------------------------------------------------------------
// apiFetch client tests — correlation ID injection
//
// Verifies that every apiFetch call attaches a fresh x-correlation-id header.
// Dependencies (getConfig, getSession, fetch) are mocked so no network or
// sessionStorage interaction occurs.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from './client'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

vi.mock('../config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.test' }),
}))

vi.mock('../auth/session', () => ({
  getSession: () => null,
}))

function makeOkResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch — x-correlation-id header', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches an x-correlation-id header on every call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeOkResponse({ data: 'ok' }))

    await apiFetch('/test')

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
      return makeOkResponse({ data: 'ok' })
    })

    await apiFetch('/test-a')
    await apiFetch('/test-b')

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(UUID_REGEX.test(ids[0]!)).toBe(true)
    expect(UUID_REGEX.test(ids[1]!)).toBe(true)
  })
})
