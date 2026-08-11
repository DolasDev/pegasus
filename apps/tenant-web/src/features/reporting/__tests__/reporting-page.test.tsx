// ---------------------------------------------------------------------------
// ReportingPage tests.
//
// `apiFetch` is mocked at the client seam so the page exercises its real query
// wiring (one catalog call + one batched query call) without a server.
// Recharts is mocked to a marker element: jsdom has no layout, so
// ResponsiveContainer renders at zero size and would draw nothing — the useful
// assertions are about which widget body is chosen and how failures degrade,
// not SVG geometry.
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

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))
vi.mock('@/api/client', () => ({ apiFetch: mockApiFetch }))

import { ReportingPage } from '@/routes/reporting'
import { BUILTIN_DASHBOARD } from '../builtin-dashboard'
import { parseDashboardDefinition } from '../dashboard-definition'

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReportingPage />
    </QueryClientProvider>,
  )
}

type Slot = { rows?: unknown[]; error?: { message: string; code: string } }

/**
 * Route apiFetch by path so both queries resolve independently.
 *
 * Results are POSITIONAL — the API returns one slot per request, in request
 * order — so the helper builds a full-length array aligned to the built-in
 * dashboard's widgets and fills the named ones. Tests that assert on a specific
 * widget therefore exercise the same index-matching the page does.
 */
function mockApi(bySlot: Record<string, Slot>, opts: { catalogFails?: boolean } = {}) {
  const results = BUILTIN_DASHBOARD.widgets.map((w) => ({
    datasetId: w.datasetId,
    ...(bySlot[w.datasetId] ?? { rows: [] }),
  }))
  mockApiFetch.mockImplementation((path: string) => {
    if (path.includes('/reporting/datasets')) {
      return opts.catalogFails ? Promise.reject(new Error('404')) : Promise.resolve(CATALOG)
    }
    return Promise.resolve({ results })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportingPage', () => {
  it('sends ONE batched query for the whole dashboard', async () => {
    // The Lambda concurrency cap is the reason this is a single request; a
    // regression to per-widget fetching should fail loudly here.
    mockApi({})
    renderPage()

    await waitFor(() => {
      const queryCalls = mockApiFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/reporting/query'),
      )
      expect(queryCalls).toHaveLength(1)
    })

    const [, init] = mockApiFetch.mock.calls.find((c) => String(c[0]).includes('/reporting/query'))!
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.requests).toHaveLength(BUILTIN_DASHBOARD.widgets.length)
  })

  it('renders a scalar widget as a formatted hero number', async () => {
    mockApi({ 'longhaul-invoiced-ytd': { rows: [{ amount: 1234567 }] } })
    renderPage()

    expect(await screen.findByText('$1,234,567')).toBeInTheDocument()
  })

  it('renders a scalar widget’s secondary column as supporting text', async () => {
    mockApi({ 'invoices-outstanding': { rows: [{ amount: 4200, count: 7 }] } })
    renderPage()

    expect(await screen.findByText('$4,200')).toBeInTheDocument()
    expect(await screen.findByText(/7 invoices/)).toBeInTheDocument()
  })

  it('renders a chart for a series widget', async () => {
    mockApi({
      'longhaul-new-orders-ytd': { rows: [{ moveType: 'I', description: 'Import', count: 5 }] },
    })
    renderPage()

    expect(await screen.findAllByTestId('chart')).not.toHaveLength(0)
  })

  it('degrades ONE widget when its slot carries an error', async () => {
    // The central resilience property: a tenant with no legacy DB still sees
    // its Postgres widgets. Phase-2 forked dashboards depend on this.
    mockApi({
      'longhaul-invoiced-ytd': { error: { message: 'nope', code: 'MSSQL_NOT_CONFIGURED' } },
      'invoices-outstanding': { rows: [{ amount: 4200, count: 7 }] },
    })
    renderPage()

    expect(await screen.findByText(/no legacy database configured/i)).toBeInTheDocument()
    // ...and the healthy widget beside it still rendered.
    expect(screen.getByText('$4,200')).toBeInTheDocument()
  })

  it('shows a generic message for a non-legacy dataset failure', async () => {
    mockApi({ 'invoices-outstanding': { error: { message: 'x', code: 'DATASET_ERROR' } } })
    renderPage()

    expect(await screen.findByText(/could not load this data/i)).toBeInTheDocument()
  })

  it('shows an unavailable message when the catalog 404s (feature disabled)', async () => {
    mockApi({}, { catalogFails: true })
    renderPage()

    expect(await screen.findByText(/reporting is not available/i)).toBeInTheDocument()
  })

  it('matches results to widgets by POSITION, not by datasetId', async () => {
    // Two widgets may legitimately share a dataset with different params
    // ("Outstanding 30d" beside "Outstanding 90d"). Matching results by
    // datasetId collapses them and both render the same numbers. Phase-2
    // authored dashboards make this ordinary, so pin it now.
    const twoOnOneDataset = parseDashboardDefinition({
      schemaVersion: 1,
      id: 'dupes',
      title: 'Dupes',
      widgets: [
        {
          datasetId: 'invoices-outstanding',
          datasetVersion: 1,
          params: { window: '30d' },
          widget: 'scalar',
          title: 'First',
          span: 2,
        },
        {
          datasetId: 'invoices-outstanding',
          datasetVersion: 1,
          params: { window: '90d' },
          widget: 'scalar',
          title: 'Second',
          span: 2,
        },
      ],
    })

    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/reporting/datasets')) return Promise.resolve(CATALOG)
      return Promise.resolve({
        results: [
          { datasetId: 'invoices-outstanding', rows: [{ amount: 1111, count: 1 }] },
          { datasetId: 'invoices-outstanding', rows: [{ amount: 2222, count: 2 }] },
        ],
      })
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ReportingPage definition={twoOnOneDataset} />
      </QueryClientProvider>,
    )

    // Each widget shows its OWN slot, not a shared one.
    expect(await screen.findByText('$1,111')).toBeInTheDocument()
    expect(await screen.findByText('$2,222')).toBeInTheDocument()
  })
})
