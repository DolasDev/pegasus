// ---------------------------------------------------------------------------
// Settings → Developer → Integrations tests.
//
// The page's whole job is putting each integration in the right group and
// exposing the right action there, so that is what these assert: platform rows
// get Fork and no Delete, owned rows get Delete and no Fork, built-in rows get
// neither. Pattern mirrors integration-detail.test.tsx — router primitives and
// the query/mutation hooks are mocked so the page mounts without a
// RouterProvider.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import {
  DeveloperIntegrationsPage,
  groupIntegrations,
} from '../routes/settings.developer.integrations'
import type { IntegrationFloor, IntegrationSummary } from '../api/integrations'

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

const { mockFork, mockDelete } = vi.hoisted(() => ({
  mockFork: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  mockDelete: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
}))

vi.mock('@/api/queries/integrations', () => ({
  integrationsQueryOptions: { queryKey: ['integrations', 'list'], queryFn: vi.fn() },
  integrationFloorsQueryOptions: { queryKey: ['integrations', 'floors'], queryFn: vi.fn() },
  useForkIntegrationConfig: () => mockFork,
  useDeleteIntegrationConfig: () => mockDelete,
}))

let listReturn: Record<string, unknown> = { data: undefined, isLoading: false, isError: false }
let floorsReturn: Record<string, unknown> = { data: [], isLoading: false, isError: false }

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (opts: { queryKey?: unknown[] }) => {
      const key = Array.isArray(opts?.queryKey) ? opts.queryKey : []
      return key.includes('floors') ? floorsReturn : listReturn
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const platformRow: IntegrationSummary = {
  id: 'weichert',
  name: 'Weichert',
  description: 'Platform-published partner.',
  published: true,
  version: 3,
  visibility: 'GLOBAL',
}

const ownedRow: IntegrationSummary = {
  id: 'sirva_ade_shipment',
  name: 'Sirva ADE — Shipment',
  description: 'Forked and customized.',
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

const floor: IntegrationFloor = {
  floor: 'shipment_status_update',
  canonicalFields: ['serviceOrderNumber', 'shipments[].supplierShipmentId'],
  factCatalog: { serviceStatus: 'string', shipmentCount: 'number' },
  factDocs: { shipmentCount: 'How many shipments the order carries.' },
  inputFieldRoots: ['Survey', 'InvolvedParties'],
  defaultAction: 'save',
  projection: { entityType: 'shipment' },
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DeveloperIntegrationsPage />
    </QueryClientProvider>,
  )
}

/** The group region a row should live in, so group membership is asserted. */
function card(title: string): HTMLElement {
  return screen.getByRole('region', { name: title })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFork.isPending = false
  mockFork.isError = false
  mockFork.error = null
  mockDelete.isPending = false
  mockDelete.isError = false
  mockDelete.error = null
  listReturn = {
    data: [platformRow, ownedRow, builtInRow],
    isLoading: false,
    isError: false,
  }
  floorsReturn = { data: [floor], isLoading: false, isError: false }
})

// ---------------------------------------------------------------------------
// Grouping (pure)
// ---------------------------------------------------------------------------

describe('groupIntegrations', () => {
  it('splits platform / built-in / owned by published + visibility', () => {
    const { platform, builtIn, owned } = groupIntegrations([platformRow, ownedRow, builtInRow])
    expect(platform.map((i) => i.id)).toEqual(['weichert'])
    expect(owned.map((i) => i.id)).toEqual(['sirva_ade_shipment'])
    expect(builtIn.map((i) => i.id)).toEqual(['demo_partner'])
  })

  it('treats an unpublished row as built-in even if it carries a visibility', () => {
    // Defensive: `published: false` is the authority — an unpublished row has no
    // active config to own, whatever else the payload says.
    const odd = { ...builtInRow, visibility: 'TENANT' as const }
    const { builtIn, owned } = groupIntegrations([odd])
    expect(builtIn).toHaveLength(1)
    expect(owned).toHaveLength(0)
  })

  it('lists a forked integration once, as owned', () => {
    // The API resolves a forked id to the tenant's own row, so the same id never
    // arrives twice — assert we do not invent a platform entry for it.
    const { platform, owned } = groupIntegrations([ownedRow])
    expect(owned).toHaveLength(1)
    expect(platform).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rendering + actions
// ---------------------------------------------------------------------------

describe('DeveloperIntegrationsPage', () => {
  it('renders all four groups with counts', () => {
    renderPage()
    expect(screen.getByText('Integration floors')).toBeInTheDocument()
    expect(screen.getByText('Platform integrations')).toBeInTheDocument()
    expect(screen.getByText('Built-in baselines')).toBeInTheDocument()
    expect(screen.getByText('Your integrations')).toBeInTheDocument()
  })

  it('puts each integration in its own group', () => {
    renderPage()
    expect(within(card('Platform integrations')).getByText('Weichert')).toBeInTheDocument()
    expect(within(card('Your integrations')).getByText('Sirva ADE — Shipment')).toBeInTheDocument()
    expect(within(card('Built-in baselines')).getByText('Demo Partner')).toBeInTheDocument()
  })

  it('offers Fork only on platform rows', () => {
    renderPage()
    expect(
      within(card('Platform integrations')).getByRole('button', { name: /fork/i }),
    ).toBeEnabled()
    expect(
      within(card('Your integrations')).queryByRole('button', { name: /fork/i }),
    ).not.toBeInTheDocument()
    expect(
      within(card('Built-in baselines')).queryByRole('button', { name: /fork/i }),
    ).not.toBeInTheDocument()
  })

  it('offers Delete only on tenant-owned rows', () => {
    renderPage()
    expect(within(card('Your integrations')).getByRole('button', { name: /delete/i })).toBeEnabled()
    expect(
      within(card('Platform integrations')).queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument()
    expect(
      within(card('Built-in baselines')).queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument()
  })

  it('forks the platform integration by id', () => {
    renderPage()
    fireEvent.click(within(card('Platform integrations')).getByRole('button', { name: /fork/i }))
    expect(mockFork.mutate).toHaveBeenCalledWith('weichert')
  })

  it('requires confirmation before deleting, and explains the fallback', () => {
    renderPage()
    fireEvent.click(within(card('Your integrations')).getByRole('button', { name: /delete/i }))
    expect(mockDelete.mutate).not.toHaveBeenCalled()
    expect(screen.getByText(/Delete your config for Sirva ADE — Shipment\?/)).toBeInTheDocument()
    expect(screen.getByText(/falls back to the platform config/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }))
    expect(mockDelete.mutate).toHaveBeenCalledWith(
      { integrationId: 'sirva_ade_shipment' },
      expect.anything(),
    )
  })

  it('cancelling the confirm deletes nothing', () => {
    renderPage()
    fireEvent.click(within(card('Your integrations')).getByRole('button', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockDelete.mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  it('explains a FEATURE_DISABLED fork failure instead of showing a bare error', () => {
    mockFork.isError = true
    mockFork.error = new ApiError(
      'Integration config publishing is not enabled',
      'FEATURE_DISABLED',
      403,
    )
    renderPage()
    expect(screen.getByText(/not enabled in this environment/i)).toBeInTheDocument()
  })

  it('surfaces a DEPENDENTS_EXIST delete conflict with its detail', () => {
    mockDelete.isError = true
    mockDelete.error = new ApiError(
      '2 tenant(s) still have their own config.',
      'DEPENDENTS_EXIST',
      409,
    )
    renderPage()
    expect(screen.getByText(/2 tenant\(s\) still have their own config/)).toBeInTheDocument()
  })

  it('renders floors and expands one to its fact catalog', () => {
    renderPage()
    const floors = card('Integration floors')
    expect(within(floors).getByText('shipment_status_update')).toBeInTheDocument()
    expect(within(floors).getByText('2 facts')).toBeInTheDocument()
    // Collapsed: facts hidden.
    expect(within(floors).queryByText('shipmentCount')).not.toBeInTheDocument()

    fireEvent.click(within(floors).getByRole('button', { expanded: false }))
    expect(within(floors).getByText('shipmentCount')).toBeInTheDocument()
    expect(within(floors).getByText(/How many shipments the order carries/)).toBeInTheDocument()
    expect(within(floors).getByText(/Survey, InvolvedParties/)).toBeInTheDocument()
  })

  it('shows an empty state per group rather than a blank card', () => {
    listReturn = { data: [], isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText('No platform integrations')).toBeInTheDocument()
    expect(screen.getByText('No integrations of your own')).toBeInTheDocument()
  })

  it('surfaces a failed list load', () => {
    listReturn = { data: undefined, isLoading: false, isError: true }
    renderPage()
    expect(screen.getAllByText('Failed to load integrations.').length).toBeGreaterThan(0)
  })
})
