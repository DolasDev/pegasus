// ---------------------------------------------------------------------------
// Settings → Developer → Usage tests.
//
// The page renders one API response (GET /api/v1/usage/summary). useQuery is
// mocked so each case feeds it a summary, the same pattern as
// developer-integrations.test.tsx.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ApiError } from '@/api/client'
import type { UsageSummary } from '@/api/usage'
import { DeveloperUsagePage, actionLabel, lastDayOf } from '../routes/settings.developer.usage'

vi.mock('@/api/queries/usage', () => ({
  usageSummaryQueryOptions: () => ({ queryKey: ['usage', 'summary', 'current'], queryFn: vi.fn() }),
}))

let queryReturn: Record<string, unknown> = { data: undefined, isLoading: false, isError: false }

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return { ...actual, useQuery: () => queryReturn }
})

const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9 + i, 1))
  return { month: d.toISOString().slice(0, 7), actions: i === 0 ? 120 : i === 1 ? 300 : 0 }
})

const summary: UsageSummary = {
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
  usedTermToDate: 420,
  remaining: 5_580,
  overageActions: 0,
  projectedAtTermEnd: 3_300,
  asOf: '2026-11-15',
  byMonth: months,
  byAction: [
    { action: 'SendSms', actions: 400 },
    { action: 'UpdateTextMessage', actions: 15 },
    { action: 'SomethingNew', actions: 5 },
  ],
  byWorkflow: [
    { workflowId: 'wf-1', workflowName: 'nw_pulse_texting', actions: 410 },
    { workflowId: null, workflowName: null, actions: 10 },
  ],
}

function renderWith(data: UsageSummary) {
  queryReturn = { data, isLoading: false, isError: false, error: null }
  return render(<DeveloperUsagePage />)
}

beforeEach(() => {
  queryReturn = { data: undefined, isLoading: false, isError: false }
})

describe('helpers', () => {
  it('labels known actions and falls back to the raw id', () => {
    expect(actionLabel('SendSms')).toBe('Texts sent')
    expect(actionLabel('CallExternal')).toBe('Integration calls (writes)')
    expect(actionLabel('SomethingNew')).toBe('SomethingNew')
  })
  it('turns an exclusive term end into the last day', () => {
    expect(lastDayOf('2027-10-01')).toBe('2027-09-30')
    expect(lastDayOf('2027-01-01')).toBe('2026-12-31')
  })
})

describe('DeveloperUsagePage', () => {
  it('renders the plan, the meter, and the breakdown tables', () => {
    renderWith(summary)
    expect(screen.getByText('Starter')).toBeInTheDocument()
    expect(screen.getByText(/2026-10-01 – 2027-09-30/)).toBeInTheDocument()

    const meter = screen.getByTestId('usage-meter')
    expect(within(meter).getByText('420')).toBeInTheDocument()
    expect(within(meter).getByText(/of 6,000 actions/)).toBeInTheDocument()
    expect(within(meter).getByText(/5,580 remaining/)).toBeInTheDocument()
    expect(within(meter).getByText(/3,300/)).toBeInTheDocument()
    expect(within(meter).getByText(/estimate/i)).toBeInTheDocument()
    expect(within(meter).queryByText(/over the pool/i)).not.toBeInTheDocument()

    const actions = screen.getByTestId('usage-by-action')
    expect(within(actions).getByText('Texts sent')).toBeInTheDocument()
    expect(within(actions).getByText('Texts marked read')).toBeInTheDocument()
    expect(within(actions).getByText('SomethingNew')).toBeInTheDocument()

    const workflows = screen.getByTestId('usage-by-workflow')
    expect(within(workflows).getByText('nw_pulse_texting')).toBeInTheDocument()
    expect(within(workflows).getByText('API clients (not a workflow)')).toBeInTheDocument()

    expect(screen.getAllByTestId('usage-month-bar')).toHaveLength(12)
    expect(screen.getByRole('link', { name: /published plans/i })).toHaveAttribute(
      'href',
      'https://pegasusmovemanager.com/#automation',
    )
    // Prices are never shown.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('explains the calendar-year window when no plan is assigned', () => {
    renderWith({
      ...summary,
      plan: null,
      pool: null,
      remaining: null,
      termStart: '2026-01-01',
      termEnd: '2027-01-01',
    })
    expect(
      screen.getByText(/No automation plan assigned — usage shown for the calendar year/),
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('usage-meter')).getByText('420')).toBeInTheDocument()
  })

  it('shows overage once the pool is passed', () => {
    renderWith({ ...summary, usedTermToDate: 6_250, remaining: 0, overageActions: 250 })
    expect(
      within(screen.getByTestId('usage-meter')).getByText(/250 over the pool/),
    ).toBeInTheDocument()
  })

  it('hides the projection when the term is over', () => {
    renderWith({ ...summary, projectedAtTermEnd: null })
    expect(
      within(screen.getByTestId('usage-meter')).queryByText(/estimate/i),
    ).not.toBeInTheDocument()
  })

  it('renders a clean tenant-admin message on 403', () => {
    queryReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('Forbidden', 'FORBIDDEN', 403),
    }
    render(<DeveloperUsagePage />)
    expect(screen.getByText(/requires the tenant admin role/i)).toBeInTheDocument()
  })

  it('renders a generic error otherwise', () => {
    queryReturn = { data: undefined, isLoading: false, isError: true, error: new Error('boom') }
    render(<DeveloperUsagePage />)
    expect(screen.getByText(/could not load usage/i)).toBeInTheDocument()
  })
})
