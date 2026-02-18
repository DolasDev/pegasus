import { describe, it, expect } from 'vitest'
import { app } from './app'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('ok')
    expect(typeof body['timestamp']).toBe('string')
  })
})

describe('GET /moves', () => {
  it('returns 200 with an empty moves array', async () => {
    const res = await app.request('/moves')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['moves'])).toBe(true)
    expect(body['total']).toBe(0)
  })
})

describe('GET /moves/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/moves/unknown-id')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['id']).toBe('unknown-id')
  })
})

describe('unknown route', () => {
  it('returns 404', async () => {
    const res = await app.request('/not-a-real-route')
    expect(res.status).toBe(404)
  })
})
