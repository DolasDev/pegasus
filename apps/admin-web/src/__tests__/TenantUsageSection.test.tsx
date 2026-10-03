import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { TenantUsageSection } from '../components/TenantUsageSection'
import { ApiError } from '../api/client'
import type { AutomationPlanState, UsageStatement, UsageSummary } from '../api/usage'
import type * as UsageApi from '../api/usage'

// ---------------------------------------------------------------------------
// Mocks — the section's API calls. The pure helpers (formatCents, escalate)
// and the CSV download (tested separately below) stay real.
// ---------------------------------------------------------------------------

vi.mock('@/api/usage', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual,
    getTenantUsage: vi.fn(),
    getAutomationPlan: vi.fn(),
    assignAutomationPlan: vi.fn(),
    listUsageStatements: vi.fn(),
    exportStatementCsv: vi.fn(),
  }
})

vi.mock('@/auth/cognito', () => ({ getAccessToken: () => 'tok-123' }))
vi.mock('@/config', () => ({ getConfig: () => ({ apiUrl: 'https://api.test' }) }))

import {
  getTenantUsage,
  getAutomationPlan,
  assignAutomationPlan,
  listUsageStatements,
  exportStatementCsv,
} from '@/api/usage'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATALOG = [
  {
    code: 'STARTER',
    name: 'Starter',
    monthlyPriceCents: 30_000,
    annualPoolActions: 6_000,
    overageCentsPerAction: 30,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    monthlyPriceCents: 65_000,
    annualPoolActions: 15_000,
    overageCentsPerAction: 30,
  },
  {
    code: 'SCALE',
    name: 'Scale',
    monthlyPriceCents: 120_000,
    annualPoolActions: 50_000,
    overageCentsPerAction: 30,
  },
] as const

const PLAN_ROW = {
  id: 'plan-1',
  planCode: 'STARTER' as const,
  monthlyPriceCents: 30_000,
  annualPoolActions: 6_000,
  overageCentsPerAction: 30,
  termStart: '2026-10-01',
  termEnd: '2027-10-01',
  effectiveFrom: '2026-10-01',
  createdAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'admin@platform.com',
}

const PLAN_STATE: AutomationPlanState = {
  current: PLAN_ROW,
  history: [PLAN_ROW],
  catalog: [...CATALOG],
}

const SUMMARY: UsageSummary = {
  plan: {
    planCode: 'STARTER',
    name: 'Starter',
    monthlyPriceCents: 30_000,
    annualPoolActions: 6_000,
    overageCentsPerAction: 30,
    effectiveFrom: '2026-10-01',
  },
  termStart: '2026-10-01',
  termEnd: '2027-10-01',
  pool: 6_000,
  usedTermToDate: 412,
  remaining: 5_588,
  overageActions: 0,
  projectedAtTermEnd: 3_270,
  asOf: '2026-11-15',
  byMonth: [
    { month: '2026-10', actions: 150 },
    { month: '2026-11', actions: 262 },
  ],
  byAction: [
    { action: 'SendSms', actions: 400 },
    { action: 'UpdateTextMessage', actions: 12 },
  ],
  byWorkflow: [{ workflowId: 'wf-1', workflowName: 'nw_pulse_texting', actions: 412 }],
}

const STATEMENT: UsageStatement = {
  id: 'st-1',
  periodMonth: '2026-10',
  planCode: 'STARTER',
  termStart: '2026-10-01',
  termEnd: '2027-10-01',
  monthlyPriceCents: 30_000,
  proRatedPlanCents: 30_000,
  actionsInMonth: 150,
  termToDateActions: 150,
  pool: 6_000,
  overageActions: 0,
  overageCentsPerAction: 30,
  overageCents: 0,
  totalCents: 30_000,
  closedAt: '2026-11-01T06:00:00.000Z',
}

function renderSection(tenantId = 'tenant-1') {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TenantUsageSection tenantId={tenantId} />
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantUsageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantUsage).mockResolvedValue(SUMMARY)
    vi.mocked(getAutomationPlan).mockResolvedValue(PLAN_STATE)
    vi.mocked(listUsageStatements).mockResolvedValue([STATEMENT])
    vi.mocked(exportStatementCsv).mockResolvedValue(undefined)
  })

  it('renders the usage summary and the plan history', async () => {
    renderSection()

    const summary = await screen.findByTestId('usage-summary')
    expect(within(summary).getByText(/Starter/)).toBeInTheDocument()
    expect(within(summary).getByTestId('usage-used')).toHaveTextContent('412')
    expect(within(summary).getByTestId('usage-pool')).toHaveTextContent('6,000')
    expect(within(summary).getByTestId('usage-remaining')).toHaveTextContent('5,588')
    expect(within(summary).getByTestId('usage-projected')).toHaveTextContent('3,270')
    expect(within(summary).getByText(/estimate/i)).toBeInTheDocument()
    expect(within(summary).getByText('nw_pulse_texting')).toBeInTheDocument()
    expect(within(summary).getByText('SendSms')).toBeInTheDocument()

    const history = await screen.findByTestId('plan-history')
    expect(within(history).getByText('STARTER')).toBeInTheDocument()
    expect(within(history).getByText('$300.00')).toBeInTheDocument()
    expect(within(history).getByText('admin@platform.com')).toBeInTheDocument()

    expect(getTenantUsage).toHaveBeenCalledWith('tenant-1')
  })

  it('submits the plan form with the catalog prices prefilled', async () => {
    vi.mocked(assignAutomationPlan).mockResolvedValue({ ...PLAN_ROW, id: 'plan-2' })
    renderSection()

    const form = await screen.findByTestId('plan-form')
    fireEvent.change(within(form).getByLabelText('Plan'), { target: { value: 'GROWTH' } })
    fireEvent.change(within(form).getByLabelText('Term start'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(within(form).getByLabelText(/Effective from/), {
      target: { value: '2027-02-10' },
    })
    fireEvent.click(within(form).getByRole('button', { name: /Assign plan/ }))

    await waitFor(() =>
      expect(assignAutomationPlan).toHaveBeenCalledWith('tenant-1', {
        planCode: 'GROWTH',
        termStart: '2026-10-01',
        effectiveFrom: '2027-02-10',
        monthlyPriceCents: 65_000,
        annualPoolActions: 15_000,
        overageCentsPerAction: 30,
      }),
    )
    // Plan and usage refresh on success.
    await waitFor(() => expect(getAutomationPlan).toHaveBeenCalledTimes(2))
    expect(getTenantUsage).toHaveBeenCalledTimes(2)
  })

  it('applies N renewals of 4% to the prefilled prices', async () => {
    vi.mocked(assignAutomationPlan).mockResolvedValue(PLAN_ROW)
    renderSection()

    const form = await screen.findByTestId('plan-form')
    fireEvent.change(within(form).getByLabelText('Plan'), { target: { value: 'SCALE' } })
    fireEvent.change(within(form).getByLabelText('Term start'), {
      target: { value: '2027-10-01' },
    })
    fireEvent.change(within(form).getByLabelText('Renewals'), { target: { value: '1' } })
    fireEvent.click(within(form).getByRole('button', { name: /Apply escalator/ }))
    expect(within(form).getByLabelText('Monthly price (cents)')).toHaveValue(124_800)
    expect(within(form).getByLabelText('Overage (cents/action)')).toHaveValue(31)

    fireEvent.click(within(form).getByRole('button', { name: /Assign plan/ }))
    await waitFor(() =>
      expect(assignAutomationPlan).toHaveBeenCalledWith('tenant-1', {
        planCode: 'SCALE',
        termStart: '2027-10-01',
        monthlyPriceCents: 124_800,
        annualPoolActions: 50_000,
        overageCentsPerAction: 31,
      }),
    )
  })

  it('renders a 422 INVALID_PLAN_CHANGE message inline', async () => {
    vi.mocked(assignAutomationPlan).mockRejectedValue(
      new ApiError(
        'within a term a plan can only move up; move down at renewal',
        'INVALID_PLAN_CHANGE',
        422,
      ),
    )
    renderSection()

    const form = await screen.findByTestId('plan-form')
    fireEvent.change(within(form).getByLabelText('Term start'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.click(within(form).getByRole('button', { name: /Assign plan/ }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'within a term a plan can only move up; move down at renewal',
    )
  })

  it('blocks a term start that is not the 1st of a month', async () => {
    renderSection()
    const form = await screen.findByTestId('plan-form')
    fireEvent.change(within(form).getByLabelText('Term start'), {
      target: { value: '2026-10-15' },
    })
    fireEvent.click(within(form).getByRole('button', { name: /Assign plan/ }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(/1st of a month/)
    expect(assignAutomationPlan).not.toHaveBeenCalled()
  })

  it('lists statements and exports one as CSV', async () => {
    renderSection()
    const statements = await screen.findByTestId('usage-statements')
    expect(within(statements).getByText('2026-10')).toBeInTheDocument()
    fireEvent.click(within(statements).getByRole('button', { name: /Export statement \(CSV\)/ }))
    await waitFor(() => expect(exportStatementCsv).toHaveBeenCalledWith('tenant-1', '2026-10'))
  })

  it('says so when the tenant has no plan', async () => {
    vi.mocked(getTenantUsage).mockResolvedValue({
      ...SUMMARY,
      plan: null,
      pool: null,
      remaining: null,
      termStart: '2026-01-01',
      termEnd: '2027-01-01',
    })
    vi.mocked(getAutomationPlan).mockResolvedValue({
      current: null,
      history: [],
      catalog: [...CATALOG],
    })
    vi.mocked(listUsageStatements).mockResolvedValue([])
    renderSection()
    expect(
      await screen.findByText(/No automation plan — counting calendar year/),
    ).toBeInTheDocument()
    expect(await screen.findByText(/No automation plan has been assigned/)).toBeInTheDocument()
    expect(await screen.findByText(/No closed statements yet/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The real CSV download — the right URL, with the admin bearer token.
// ---------------------------------------------------------------------------

describe('exportStatementCsv', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('fetches the statement CSV with the admin token and downloads a blob', async () => {
    const actual = await vi.importActual<typeof UsageApi>('../api/usage')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('tenantId,periodMonth\nt,2026-10\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await actual.exportStatementCsv('tenant-1', '2026-10')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/admin/tenants/tenant-1/usage/statements/2026-10?format=csv',
      { headers: { Authorization: 'Bearer tok-123' } },
    )
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })

  it('throws an ApiError carrying the API message on failure', async () => {
    const actual = await vi.importActual<typeof UsageApi>('../api/usage')
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'No statement for 2026-11', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    await expect(actual.exportStatementCsv('tenant-1', '2026-11')).rejects.toMatchObject({
      message: 'No statement for 2026-11',
      code: 'NOT_FOUND',
      status: 404,
    })
  })
})
