// ---------------------------------------------------------------------------
// Unit tests for tenantMiddleware
//
// The real middleware is imported directly — this file deliberately does NOT
// mock ./middleware/tenant. The database and createTenantDb are mocked so no
// Postgres connection is required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Mock the Prisma base client and the tenant-scoped extension factory
// ---------------------------------------------------------------------------

vi.mock('../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
  },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})), // returns a no-op db object
}))

import { db } from '../db'
import { tenantMiddleware } from '../middleware/tenant'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', tenantMiddleware)
  app.get('/probe', (c) =>
    c.json({ tenantId: c.get('tenantId') }),
  )
  return app
}

type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED'

function mockTenant(status: TenantStatus) {
  vi.mocked(db.tenant.findUnique).mockResolvedValue({
    id: 'tenant-uuid',
    name: 'Acme Moving',
    slug: 'acme',
    status,
    plan: 'STARTER',
    contactName: null,
    contactEmail: null,
    ssoProviderConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
}

function slugHeader(slug: string): RequestInit {
  return { headers: { 'X-Tenant-Slug': slug } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenantMiddleware', () => {
  beforeEach(() => {
    vi.mocked(db.tenant.findUnique).mockReset()
  })

  // ── Slug extraction ────────────────────────────────────────────────────────

  it('returns 400 when no tenant slug can be determined', async () => {
    const res = await buildApp().request('/probe')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_REQUIRED')
  })

  it('resolves the tenant via X-Tenant-Slug header', async () => {
    mockTenant('ACTIVE')
    const res = await buildApp().request('/probe', slugHeader('acme'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['tenantId']).toBe('tenant-uuid')
  })

  it('resolves the tenant via Host header subdomain', async () => {
    mockTenant('ACTIVE')
    const res = await buildApp().request('/probe', {
      headers: { host: 'acme.pegasusapp.com' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['tenantId']).toBe('tenant-uuid')
  })

  it('ignores reserved subdomains (www) from the Host header', async () => {
    const res = await buildApp().request('/probe', {
      headers: { host: 'www.pegasusapp.com' },
    })
    // No X-Tenant-Slug fallback → 400 TENANT_REQUIRED
    expect(res.status).toBe(400)
  })

  // ── Unknown tenant ─────────────────────────────────────────────────────────

  it('returns 404 when the slug does not match any tenant', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)
    const res = await buildApp().request('/probe', slugHeader('unknown'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_NOT_FOUND')
  })

  // ── Status enforcement ────────────────────────────────────────────────────

  it('passes requests through for ACTIVE tenants', async () => {
    mockTenant('ACTIVE')
    const res = await buildApp().request('/probe', slugHeader('acme'))
    expect(res.status).toBe(200)
  })

  it('returns 403 TENANT_SUSPENDED for SUSPENDED tenants', async () => {
    mockTenant('SUSPENDED')
    const res = await buildApp().request('/probe', slugHeader('acme'))
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_SUSPENDED')
  })

  it('returns 404 TENANT_NOT_FOUND for OFFBOARDED tenants (indistinguishable from unknown slug)', async () => {
    mockTenant('OFFBOARDED')
    const res = await buildApp().request('/probe', slugHeader('acme'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('TENANT_NOT_FOUND')
  })

  it('does not expose OFFBOARDED status in the response body', async () => {
    mockTenant('OFFBOARDED')
    const res = await buildApp().request('/probe', slugHeader('acme'))
    const text = await res.text()
    expect(text).not.toContain('OFFBOARDED')
    expect(text).not.toContain('offboard')
  })
})
