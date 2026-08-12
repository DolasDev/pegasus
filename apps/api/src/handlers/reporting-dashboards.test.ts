// ---------------------------------------------------------------------------
// Unit tests for the dashboard CRUD handlers.
//
// The repository and the AVP permission lookup are mocked, so these run without
// Postgres. What is worth pinning here is the stuff a repository test cannot
// see: that visibility is derived SERVER-side, that a user-authored document is
// re-validated against the registry, and that drift is a warning not an error.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

vi.mock('../lib/authz', () => ({ listAllowedPermissions: vi.fn() }))
vi.mock('../middleware/rbac', () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

const repoMock = {
  publish: vi.fn(),
  listVisible: vi.fn(),
  resolveBySlug: vi.fn(),
  findGlobal: vi.fn(),
  findOwn: vi.fn(),
  archive: vi.fn(),
}
vi.mock('../repositories/dashboard-definition.repository', () => ({
  createDashboardDefinitionRepository: () => repoMock,
}))

import { reportingDashboardsHandler } from './reporting-dashboards'
import { listAllowedPermissions } from '../lib/authz'

const permissionsMock = listAllowedPermissions as unknown as Mock
const ALL_PERMS = ['move:list', 'invoice:read', 'quote:read', 'report:read', 'dashboard:manage']

const findTenant = vi.fn()

function buildApp(isPlatformTenant = false) {
  findTenant.mockResolvedValue({ isPlatformTenant })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-1')
    c.set('correlationId', 'corr-1')
    c.set('principal', { sub: 's', tenantId: 'tenant-1', roleNames: ['tenant_admin'] })
    c.set('db', { tenant: { findUnique: findTenant } } as never)
    await next()
  })
  app.route('/dashboards', reportingDashboardsHandler)
  return app
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    tenantId: 'tenant-1',
    slug: 'ops',
    version: 1,
    visibility: 'TENANT',
    status: 'PUBLISHED',
    title: 'Ops',
    description: null,
    definition: { schemaVersion: 2, widgets: [] },
    publishedBy: 'user-1',
    forkedFromDefinitionId: null,
    forkedFromVersion: null,
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...over,
  }
}

const widget = {
  datasetId: 'moves-by-status',
  datasetVersion: 1,
  widget: 'bar',
  title: 'Moves',
  span: 2,
  layout: { x: 0, y: 0, w: 6, h: 4 },
}

function post(app: Hono<AppEnv>, path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface ErrBody {
  error: string
  code: string
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['REPORTING_ENABLED'] = 'true'
  permissionsMock.mockResolvedValue(ALL_PERMS)
})

afterEach(() => {
  delete process.env['REPORTING_ENABLED']
})

describe('GET /dashboards', () => {
  it('marks the caller’s own rows owned and GLOBAL ones forkable', async () => {
    repoMock.listVisible.mockResolvedValue([
      row({ slug: 'mine' }),
      row({ slug: 'theirs', tenantId: 'platform', visibility: 'GLOBAL' }),
    ])

    const body = await json<{ data: { dashboards: Record<string, unknown>[] } }>(
      await buildApp().request('/dashboards'),
    )

    expect(body.data.dashboards[0]).toMatchObject({ slug: 'mine', owned: true, forkable: false })
    expect(body.data.dashboards[1]).toMatchObject({
      slug: 'theirs',
      owned: false,
      forkable: true,
    })
  })

  it('never leaks tenantId on the wire', async () => {
    repoMock.listVisible.mockResolvedValue([row()])
    const text = await (await buildApp().request('/dashboards')).text()
    expect(text).not.toContain('tenantId')
    expect(text).not.toContain('tenant-1')
  })
})

describe('GET /dashboards/:slug', () => {
  it('returns the resolved dashboard', async () => {
    repoMock.resolveBySlug.mockResolvedValue(row({ slug: 'ops', version: 4 }))
    const res = await buildApp().request('/dashboards/ops')
    const body = await json<{ data: { slug: string; version: number } }>(res)

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ slug: 'ops', version: 4, owned: true })
    expect(repoMock.resolveBySlug).toHaveBeenCalledWith('ops', 'tenant-1')
  })

  it('404s a slug nobody published', async () => {
    repoMock.resolveBySlug.mockResolvedValue(null)
    const res = await buildApp().request('/dashboards/nope')
    expect(res.status).toBe(404)
  })
})

describe('POST /dashboards — validation', () => {
  it('rejects a malformed JSON body', async () => {
    const res = await buildApp().request('/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('INVALID_BODY')
  })

  it('rejects a body missing required fields', async () => {
    const res = await post(buildApp(), '/dashboards', { title: 'No slug' })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('INVALID_BODY')
  })

  it('rejects a non-kebab slug', async () => {
    const res = await post(buildApp(), '/dashboards', {
      slug: 'Not A Slug',
      title: 'T',
      definition: { schemaVersion: 2, widgets: [widget] },
    })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('INVALID_SLUG')
  })

  it('rejects a definition referencing an unknown dataset', async () => {
    const res = await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'T',
      definition: { schemaVersion: 2, widgets: [{ ...widget, datasetId: 'no-such' }] },
    })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('UNKNOWN_DATASET')
  })

  it('rejects a definition whose widget params fail the dataset’s own schema', async () => {
    const res = await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'T',
      definition: {
        schemaVersion: 2,
        widgets: [{ ...widget, params: { window: 'forever' } }],
      },
    })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('INVALID_WIDGET_PARAMS')
  })

  it('403s when the author cannot read a dataset they referenced', async () => {
    // move:list withheld — an author must not persist a reference to data they
    // cannot see, even though the query endpoint would refuse it later anyway.
    permissionsMock.mockResolvedValue(['report:read', 'dashboard:manage'])
    const res = await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'T',
      definition: { schemaVersion: 2, widgets: [widget] },
    })
    expect(res.status).toBe(403)
  })

  it('rejects a malformed document', async () => {
    const res = await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'T',
      definition: { schemaVersion: 2, widgets: 'not an array' },
    })
    expect(res.status).toBe(400)
    expect((await json<ErrBody>(res)).code).toBe('INVALID_DEFINITION')
  })
})

describe('POST /dashboards — publish', () => {
  it('derives TENANT visibility for an ordinary tenant', async () => {
    repoMock.publish.mockResolvedValue(row())
    await post(buildApp(false), '/dashboards', {
      slug: 'ops',
      title: 'Ops',
      definition: { schemaVersion: 2, widgets: [widget] },
    })
    expect(repoMock.publish).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'TENANT' }))
  })

  it('derives GLOBAL visibility for the platform tenant', async () => {
    repoMock.publish.mockResolvedValue(row({ visibility: 'GLOBAL' }))
    await post(buildApp(true), '/dashboards', {
      slug: 'ops',
      title: 'Ops',
      definition: { schemaVersion: 2, widgets: [widget] },
    })
    expect(repoMock.publish).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'GLOBAL' }))
  })

  it('ignores a client-supplied visibility — it is server-derived', async () => {
    // A tenant must not be able to publish something every other tenant sees.
    repoMock.publish.mockResolvedValue(row())
    await post(buildApp(false), '/dashboards', {
      slug: 'ops',
      title: 'Ops',
      visibility: 'GLOBAL',
      definition: { schemaVersion: 2, widgets: [widget] },
    })
    expect(repoMock.publish).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'TENANT' }))
  })

  it('upgrades and stores a v1 document a client submits', async () => {
    repoMock.publish.mockResolvedValue(row())
    await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'Ops',
      definition: {
        schemaVersion: 1,
        widgets: [
          { datasetId: 'moves-by-status', datasetVersion: 1, widget: 'bar', title: 'M', span: 2 },
        ],
      },
    })
    const stored = repoMock.publish.mock.calls[0]![0].definition
    expect(stored.schemaVersion).toBe(2)
    expect(stored.widgets[0].layout).toEqual({ x: 0, y: 0, w: 6, h: 4 })
  })

  it('publishes with a drift WARNING rather than refusing', async () => {
    // Blocking on drift would make a dataset version bump instantly
    // un-publishable for every dashboard referencing it.
    repoMock.publish.mockResolvedValue(row())
    const res = await post(buildApp(), '/dashboards', {
      slug: 'ops',
      title: 'Ops',
      definition: { schemaVersion: 2, widgets: [{ ...widget, datasetVersion: 99 }] },
    })

    expect(res.status).toBe(201)
    const body = await json<{ data: { warnings: { datasetId: string }[] } }>(res)
    expect(body.data.warnings).toEqual([
      { datasetId: 'moves-by-status', authoredAgainst: 99, current: 1 },
    ])
  })
})

describe('POST /dashboards/:slug/fork', () => {
  it('copies the GLOBAL definition into a TENANT row recording provenance', async () => {
    repoMock.findGlobal.mockResolvedValue(row({ id: 'src', tenantId: 'platform', version: 3 }))
    repoMock.findOwn.mockResolvedValue(null)
    repoMock.publish.mockResolvedValue(row())

    const res = await post(buildApp(), '/dashboards/ops/fork')

    expect(res.status).toBe(201)
    expect(repoMock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'TENANT',
        forkedFromDefinitionId: 'src',
        forkedFromVersion: 3,
      }),
    )
  })

  it('404s when there is no GLOBAL dashboard under that slug', async () => {
    repoMock.findGlobal.mockResolvedValue(null)
    const res = await post(buildApp(), '/dashboards/ops/fork')
    expect(res.status).toBe(404)
  })

  it('409s rather than creating a second lineage when already forked', async () => {
    repoMock.findGlobal.mockResolvedValue(row({ tenantId: 'platform' }))
    repoMock.findOwn.mockResolvedValue(row())
    const res = await post(buildApp(), '/dashboards/ops/fork')
    expect(res.status).toBe(409)
    expect((await json<ErrBody>(res)).code).toBe('ALREADY_FORKED')
    expect(repoMock.publish).not.toHaveBeenCalled()
  })
})

describe('DELETE /dashboards/:slug', () => {
  it('archives the caller’s lineage', async () => {
    repoMock.archive.mockResolvedValue(2)
    const res = await buildApp().request('/dashboards/ops', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(repoMock.archive).toHaveBeenCalledWith('ops', 'tenant-1')
  })

  it('404s when the tenant owns nothing under that slug', async () => {
    // Notably this is also what a tenant gets for a GLOBAL-only slug — you
    // cannot archive the platform's dashboard.
    repoMock.archive.mockResolvedValue(0)
    const res = await buildApp().request('/dashboards/ops', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
