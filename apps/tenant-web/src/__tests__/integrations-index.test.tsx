// ---------------------------------------------------------------------------
// /integrations index tests — the operator view: only integrations ACTIVE for
// this tenant (a published config, own or inherited). Built-in code baselines
// are reference material and belong to Settings → Developer → Integrations, not
// here, where they used to read as "your integration is broken".
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { IntegrationsIndexPage } from '../routes/integrations.index'
import type { IntegrationSummary } from '../api/integrations'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/api/queries/integrations', () => ({
  integrationsQueryOptions: { queryKey: ['integrations', 'list'], queryFn: vi.fn() },
}))

let listReturn: Record<string, unknown> = { data: [], isLoading: false, isError: false }

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return { ...actual, useQuery: () => listReturn }
})

const platformRow: IntegrationSummary = {
  id: 'weichert',
  name: 'Weichert',
  description: 'Inherited from the platform.',
  published: true,
  version: 3,
  visibility: 'GLOBAL',
}

const ownedRow: IntegrationSummary = {
  id: 'sirva_ade_shipment',
  name: 'Sirva ADE — Shipment',
  description: 'This tenant customized it.',
  published: true,
  version: 2,
  visibility: 'TENANT',
}

const builtInRow: IntegrationSummary = {
  id: 'demo_partner',
  name: 'Demo Partner',
  description: 'Built-in code baseline.',
  published: false,
  version: null,
  visibility: null,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IntegrationsIndexPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listReturn = { data: [platformRow, ownedRow, builtInRow], isLoading: false, isError: false }
})

describe('IntegrationsIndexPage', () => {
  it('lists published integrations, own and inherited', () => {
    renderPage()
    expect(screen.getByText('Weichert')).toBeInTheDocument()
    expect(screen.getByText('Sirva ADE — Shipment')).toBeInTheDocument()
  })

  it('hides unpublished built-in baselines', () => {
    renderPage()
    expect(screen.queryByText('Demo Partner')).not.toBeInTheDocument()
  })

  it('labels where each active config comes from', () => {
    renderPage()
    expect(screen.getByText('v3 · Platform')).toBeInTheDocument()
    expect(screen.getByText('v2 · Your config')).toBeInTheDocument()
  })

  it('shows the empty state when nothing is published, pointing at Developer', () => {
    listReturn = { data: [builtInRow], isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText('No active integrations')).toBeInTheDocument()
    expect(screen.getByText(/Settings → Developer → Integrations/)).toBeInTheDocument()
  })

  it('surfaces a failed load', () => {
    listReturn = { data: undefined, isLoading: false, isError: true }
    renderPage()
    expect(screen.getByText('Failed to load integrations.')).toBeInTheDocument()
  })
})
