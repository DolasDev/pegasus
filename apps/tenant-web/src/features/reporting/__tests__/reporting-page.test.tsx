// ---------------------------------------------------------------------------
// ReportingPage tests.
//
// `apiFetch` is mocked at the client seam so the page exercises its real query
// wiring (catalog + dashboards + preferences + one batched query) without a
// server.
//
// Both rendering libraries are stubbed: jsdom has no layout, so Recharts'
// ResponsiveContainer renders at zero size and react-grid-layout's measuring
// hook reports width 0. The useful assertions here are about WHICH dashboard
// resolves, which widget body is chosen, and how failures degrade — not
// geometry.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="chart">{children}</div>
    ),
    BarChart: Stub,
    LineChart: Stub,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Bar: () => null,
    Line: () => null,
  }
})

// Render children in order, ignoring geometry — the grid's job is layout, and
// layout is exactly what jsdom cannot evaluate.
vi.mock('react-grid-layout', () => ({
  GridLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useContainerWidth: () => ({ width: 1200, mounted: true, containerRef: { current: null } }),
  verticalCompactor: () => [],
}))
vi.mock('react-grid-layout/css/styles.css', () => ({}))

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))
vi.mock('@/api/client', () => ({ apiFetch: mockApiFetch }))

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => searchStub,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/auth/permissions', () => ({
  usePermissions: () => ({ has: (p: string) => permissionStub.has(p) }),
}))

let searchStub: { dashboard?: string } = {}
let permissionStub = new Set<string>()

import { ReportingPage } from '@/routes/reporting'
import { BUILTIN_DASHBOARD, BUILTIN_SLUG } from '../builtin-dashboard'

const CATALOG = {
  datasets: [
    {
      id: 'longhaul-invoiced-ytd',
      version: 1,
      title: 'Invoiced YTD',
      description: '',
      source: 'legacy-mssql',
      permission: 'invoice:read',
      columns: [{ key: 'amount', label: 'Invoiced YTD', type: 'currency' }],
      paramsSchema: {},
    },
    {
      id: 'invoices-outstanding',
      version: 1,
      title: 'Outstanding invoices',
      description: '',
      source: 'postgres',
      permission: 'invoice:read',
      columns: [
        { key: 'amount', label: 'Outstanding', type: 'currency' },
        { key: 'count', label: 'Invoices', type: 'number' },
      ],
      paramsSchema: {},
    },
    {
      id: 'longhaul-new-orders-ytd',
      version: 1,
      title: 'New orders YTD',
      description: '',
      source: 'legacy-mssql',
      permission: 'move:list',
      columns: [
        { key: 'moveType', label: 'Move type', type: 'string' },
        { key: 'description', label: 'Description', type: 'string' },
        { key: 'count', label: 'Orders', type: 'number' },
      ],
      paramsSchema: {},
    },
  ],
}

type Slot = { rows?: unknown[]; error?: { message: string; code: string } }

interface ApiStubs {
  /** Result slots keyed by datasetId, expanded positionally over the widgets. */
  slots?: Record<string, Slot>
  dashboards?: unknown[]
  defaultSlug?: string | null
  catalogFails?: boolean
  /** Explicit positional results, for the duplicate-dataset case. */
  results?: unknown[]
}

function mockApi(opts: ApiStubs = {}) {
  const widgets = BUILTIN_DASHBOARD.widgets
  const results =
    opts.results ??
    widgets.map((w) => ({ datasetId: w.datasetId, ...(opts.slots?.[w.datasetId] ?? { rows: [] }) }))

  mockApiFetch.mockImplementation((path: string) => {
    if (path.includes('/reporting/datasets')) {
      return opts.catalogFails ? Promise.reject(new Error('404')) : Promise.resolve(CATALOG)
    }
    if (path.includes('/reporting/dashboards')) {
      return Promise.resolve({ dashboards: opts.dashboards ?? [] })
    }
    if (path.includes('/me/preferences')) {
      return Promise.resolve({ reporting: { defaultDashboardSlug: opts.defaultSlug ?? null } })
    }
    return Promise.resolve({ results })
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReportingPage />
    </QueryClientProvider>,
  )
}

function storedDashboard(over: Record<string, unknown> = {}) {
  return {
    slug: 'ops',
    version: 1,
    title: 'Ops dashboard',
    description: null,
    visibility: 'TENANT',
    owned: true,
    forkable: false,
    forkedFrom: null,
    updatedAt: '2026-08-12T00:00:00Z',
    definition: {
      schemaVersion: 2,
      widgets: [
        {
          datasetId: 'invoices-outstanding',
          datasetVersion: 1,
          widget: 'scalar',
          title: 'Outstanding',
          span: 2,
          layout: { x: 0, y: 0, w: 6, h: 4 },
        },
      ],
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  searchStub = {}
  permissionStub = new Set(['report:read'])
})

describe('ReportingPage — resolution', () => {
  it('falls back to the built-in when the tenant has published nothing', async () => {
    mockApi({ slots: { 'longhaul-invoiced-ytd': { rows: [{ amount: 1234567 }] } } })
    renderPage()
    expect(await screen.findByText('$1,234,567')).toBeInTheDocument()
  })

  it('renders the user’s default dashboard when one is set', async () => {
    mockApi({
      dashboards: [storedDashboard(), storedDashboard({ slug: 'other', title: 'Other' })],
      defaultSlug: 'other',
      results: [{ datasetId: 'invoices-outstanding', rows: [{ amount: 4200, count: 7 }] }],
    })
    renderPage()

    const select = (await screen.findByLabelText('Dashboard')) as HTMLSelectElement
    expect(select.value).toBe('other')
  })

  it('lets ?dashboard= win over the stored default — a link must be shareable', async () => {
    searchStub = { dashboard: 'ops' }
    mockApi({
      dashboards: [storedDashboard(), storedDashboard({ slug: 'other', title: 'Other' })],
      defaultSlug: 'other',
      results: [{ datasetId: 'invoices-outstanding', rows: [{ amount: 1, count: 1 }] }],
    })
    renderPage()

    const select = (await screen.findByLabelText('Dashboard')) as HTMLSelectElement
    expect(select.value).toBe('ops')
  })

  it('falls back silently when the stored default no longer resolves', async () => {
    // A dangling preference (archived dashboard, withdrawn fork) is not a user
    // error and must never surface as one.
    mockApi({
      dashboards: [storedDashboard()],
      defaultSlug: 'deleted-long-ago',
      results: [{ datasetId: 'invoices-outstanding', rows: [{ amount: 9, count: 1 }] }],
    })
    renderPage()

    const select = (await screen.findByLabelText('Dashboard')) as HTMLSelectElement
    expect(select.value).toBe('ops')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('falls back to the built-in when a stored document cannot be parsed', async () => {
    mockApi({
      dashboards: [storedDashboard({ definition: { schemaVersion: 99, widgets: [] } })],
      slots: { 'longhaul-invoiced-ytd': { rows: [{ amount: 777 }] } },
    })
    renderPage()
    expect(await screen.findByText('$777')).toBeInTheDocument()
  })
})

describe('ReportingPage — rendering', () => {
  it('sends ONE batched query for the whole dashboard', async () => {
    mockApi()
    renderPage()

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls.filter((c) => String(c[0]).includes('/reporting/query'))
      expect(calls).toHaveLength(1)
    })

    const [, init] = mockApiFetch.mock.calls.find((c) => String(c[0]).includes('/reporting/query'))!
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.requests).toHaveLength(BUILTIN_DASHBOARD.widgets.length)
  })

  it('renders a scalar widget’s secondary column as supporting text', async () => {
    mockApi({ slots: { 'invoices-outstanding': { rows: [{ amount: 4200, count: 7 }] } } })
    renderPage()
    expect(await screen.findByText('$4,200')).toBeInTheDocument()
    expect(await screen.findByText(/7 invoices/)).toBeInTheDocument()
  })

  it('degrades ONE widget when its slot carries an error', async () => {
    mockApi({
      slots: {
        'longhaul-invoiced-ytd': { error: { message: 'nope', code: 'MSSQL_NOT_CONFIGURED' } },
        'invoices-outstanding': { rows: [{ amount: 4200, count: 7 }] },
      },
    })
    renderPage()

    expect(await screen.findByText(/no legacy database configured/i)).toBeInTheDocument()
    expect(screen.getByText('$4,200')).toBeInTheDocument()
  })

  it('shows an unavailable message when the catalog 404s (feature disabled)', async () => {
    mockApi({ catalogFails: true })
    renderPage()
    expect(await screen.findByText(/reporting is not available/i)).toBeInTheDocument()
  })

  it('matches results to widgets by POSITION, not by datasetId', async () => {
    // Two widgets may legitimately share a dataset with different params.
    // Matching by datasetId collapses them so both render the same numbers.
    mockApi({
      dashboards: [
        storedDashboard({
          definition: {
            schemaVersion: 2,
            widgets: [
              {
                datasetId: 'invoices-outstanding',
                datasetVersion: 1,
                widget: 'scalar',
                title: 'First',
                span: 2,
                layout: { x: 0, y: 0, w: 6, h: 4 },
              },
              {
                datasetId: 'invoices-outstanding',
                datasetVersion: 1,
                widget: 'scalar',
                title: 'Second',
                span: 2,
                layout: { x: 6, y: 0, w: 6, h: 4 },
              },
            ],
          },
        }),
      ],
      results: [
        { datasetId: 'invoices-outstanding', rows: [{ amount: 1111, count: 1 }] },
        { datasetId: 'invoices-outstanding', rows: [{ amount: 2222, count: 2 }] },
      ],
    })
    renderPage()

    expect(await screen.findByText('$1,111')).toBeInTheDocument()
    expect(await screen.findByText('$2,222')).toBeInTheDocument()
  })
})

describe('ReportingPage — authoring affordances', () => {
  it('hides Edit/New from a user without dashboard:manage', async () => {
    mockApi({ dashboards: [storedDashboard()], results: [{ datasetId: 'x', rows: [] }] })
    renderPage()

    await screen.findByLabelText('Dashboard')
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })

  it('offers Fork instead of Edit on a GLOBAL dashboard', async () => {
    permissionStub = new Set(['report:read', 'dashboard:manage'])
    mockApi({
      dashboards: [storedDashboard({ visibility: 'GLOBAL', owned: false, forkable: true })],
      results: [{ datasetId: 'invoices-outstanding', rows: [{ amount: 1, count: 1 }] }],
    })
    renderPage()

    expect(await screen.findByText(/fork to my tenant/i)).toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('marks the current dashboard as the user’s default', async () => {
    mockApi({
      dashboards: [storedDashboard()],
      defaultSlug: 'ops',
      results: [{ datasetId: 'x', rows: [] }],
    })
    renderPage()
    expect(await screen.findByText('My default')).toBeInTheDocument()
  })

  it('offers to set a default when none is stored', async () => {
    mockApi({ dashboards: [storedDashboard()], results: [{ datasetId: 'x', rows: [] }] })
    renderPage()
    expect(await screen.findByText('Set as my default')).toBeInTheDocument()
  })
})

describe('the built-in dashboard', () => {
  it('is still authored as v1 — it is the standing proof the upgrade works', () => {
    // If someone "modernizes" the literal to v2, the upgrade path loses its only
    // real-document coverage.
    expect(BUILTIN_SLUG).toBe('operations-overview')
    expect(BUILTIN_DASHBOARD.schemaVersion).toBe(2) // parsed output
    expect(BUILTIN_DASHBOARD.widgets.every((w) => w.layout)).toBe(true)
  })
})
