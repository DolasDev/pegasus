// ---------------------------------------------------------------------------
// Unit tests for lib/scopes.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

import { hasScope, requireScope } from '../lib/scopes'

// ---------------------------------------------------------------------------
// hasScope
// ---------------------------------------------------------------------------

describe('hasScope', () => {
  it('returns true when the required scope is present', () => {
    expect(hasScope('orders:read', ['orders:read', 'invoices:write'])).toBe(true)
  })

  it('returns false when the required scope is absent', () => {
    expect(hasScope('invoices:write', ['orders:read'])).toBe(false)
  })

  it('returns false for an empty scopes array', () => {
    expect(hasScope('orders:read', [])).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasScope('orders:read', ['Orders:Read'])).toBe(false)
  })

  it('does not do prefix matching (orders:read does not grant orders:write)', () => {
    expect(hasScope('orders:write', ['orders:read'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// requireScope middleware
// ---------------------------------------------------------------------------

type ApiClientContext = {
  apiClient: { scopes: string[]; id: string; tenantId: string }
  tenantId: string
}

function buildScopedApp(scopes: string[], scope: string) {
  const app = new Hono<{ Variables: ApiClientContext }>()
  app.use('*', async (c, next) => {
    c.set('apiClient', { id: 'client-1', tenantId: 'tenant-1', scopes })
    c.set('tenantId', 'tenant-1')
    await next()
  })
  app.get('/probe', requireScope(scope), (c) => c.json({ ok: true }))
  return app
}

describe('requireScope middleware', () => {
  it('calls next when the scope is present', async () => {
    const app = buildScopedApp(['orders:read', 'invoices:write'], 'orders:read')
    const res = await app.request('/probe')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('returns 403 FORBIDDEN when the scope is absent', async () => {
    const app = buildScopedApp(['orders:read'], 'invoices:write')
    const res = await app.request('/probe')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when scopes is empty', async () => {
    const app = buildScopedApp([], 'orders:read')
    const res = await app.request('/probe')
    expect(res.status).toBe(403)
  })

  it('returns 403 when apiClient is not set in context', async () => {
    const app = new Hono<{ Variables: Partial<ApiClientContext> }>()
    app.get('/probe', requireScope('orders:read') as never, (c) => c.json({ ok: true }))
    const res = await app.request('/probe')
    expect(res.status).toBe(403)
  })

  it('does not call next when scope is missing — next spy is not invoked', async () => {
    const nextSpy = vi.fn()
    const app = buildScopedApp(['orders:read'], 'invoices:write')
    app.get('/after', (c) => {
      nextSpy()
      return c.json({})
    })
    const res = await app.request('/probe')
    expect(res.status).toBe(403)
    expect(nextSpy).not.toHaveBeenCalled()
  })
})
