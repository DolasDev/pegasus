// ---------------------------------------------------------------------------
// IntegrationDetailPage tests — visualizes a published integration's active
// config (mapping table, rules cards, raw JSON), with loading / not-found /
// error states.
//
// Pattern mirrors developer-settings.test.tsx: router primitives are mocked so
// the page mounts without a RouterProvider, and useQuery is mocked to a
// controllable module-level return keyed by the config query.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import {
  IntegrationDetailPage,
  MappingTable,
  RulesTable,
  RawJsonView,
} from '../routes/integrations.$integrationId'
import type { IntegrationConfig } from '../api/integrations'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ integrationId: 'demo_partner' }),
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
  integrationConfigQueryOptions: (id: string) => ({
    queryKey: ['integrations', 'config', id],
    queryFn: vi.fn(),
  }),
}))

let configReturn: Record<string, unknown> = { data: undefined, isLoading: true, isError: false }

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => configReturn,
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const config: IntegrationConfig = {
  id: 'cfg-1',
  integrationId: 'demo_partner',
  version: 3,
  visibility: 'GLOBAL',
  status: 'PUBLISHED',
  mapping: {
    serviceOrderNumber: 'InvolvedParties.ShipperEmployer.Identity.Description',
    supplierContactEmail: {
      $from: 'InvolvedParties.Coordinator.EmailAddress',
      default: '',
      coerce: 'toString',
    },
    serviceStatus: { $from: 'Survey.SerivceStatus', $map: { Active: 'A', Inactive: 'I' } },
    shipments: {
      $from: '.',
      $each: {
        supplierShipmentId: { $from: 'Id', coerce: 'toString' },
      },
    },
  },
  rules: [
    {
      id: 'submit-requires-supplier-contact',
      description: 'Submitting an estimate requires a supplier contact.',
      field: 'supplierContactName',
      message: 'Supplier Contact is required to submit this estimate.',
      when: [
        { fact: 'serviceStatus', op: 'eq', value: 'Submitted' },
        { fact: 'supplierContactPresent', op: 'eq', value: false },
      ],
    },
  ],
  corpus: [{ name: 'clean', input: { order: {} }, expected: { valid: true, ruleIds: [] } }],
  publishedBy: 'user-1',
  createdAt: '2026-06-19T12:00:00Z',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IntegrationDetailPage />
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configReturn = { data: undefined, isLoading: true, isError: false }
  })

  it('shows the loading state', () => {
    configReturn = { data: undefined, isLoading: true, isError: false }
    renderPage()
    expect(screen.getByText(/loading config/i)).toBeInTheDocument()
  })

  it('renders the default (mapping) tab with version + visibility badges', () => {
    configReturn = { data: config, isLoading: false, isError: false }
    renderPage()
    // Mapping is the default tab — its content is mounted on first render.
    expect(screen.getByText('serviceOrderNumber')).toBeInTheDocument()
    expect(screen.getByText('v3')).toBeInTheDocument()
    expect(screen.getByText('GLOBAL')).toBeInTheDocument()
    // All three tab triggers render.
    expect(screen.getByRole('tab', { name: 'Mapping' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Raw JSON' })).toBeInTheDocument()
  })

  it('shows the empty state on a 404 (no published config)', () => {
    configReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('No published config', 'NOT_FOUND', 404),
    }
    renderPage()
    expect(screen.getByText('No published config')).toBeInTheDocument()
  })

  it('shows a real error banner on a non-404 failure', () => {
    configReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('boom', 'INTERNAL', 500),
    }
    renderPage()
    expect(screen.getByText(/failed to load the integration config/i)).toBeInTheDocument()
  })
})

// The tab panels (mapping / rules / raw) are unit-tested directly rather than
// via Radix tab clicks, which don't switch reliably under jsdom.
describe('MappingTable', () => {
  it('flattens string, directive, $map and $each leaves into rows', () => {
    render(<MappingTable mapping={config.mapping} />)
    expect(screen.getByText('serviceOrderNumber')).toBeInTheDocument()
    // $each nesting flattens with a dotted + [] path.
    expect(screen.getByText('shipments[]')).toBeInTheDocument()
    expect(screen.getByText('shipments[].supplierShipmentId')).toBeInTheDocument()
    // $map + coerce + default are summarized as transform badges.
    expect(screen.getByText(/map: Active→A/)).toBeInTheDocument()
    expect(screen.getByText('default: ""')).toBeInTheDocument()
    // coerce: toString appears on more than one row (directive + $each leaf).
    expect(screen.getAllByText('coerce: toString').length).toBeGreaterThanOrEqual(2)
  })

  it('renders an empty state when no fields are mapped', () => {
    render(<MappingTable mapping={{}} />)
    expect(screen.getByText('No field mappings')).toBeInTheDocument()
  })
})

describe('RulesTable', () => {
  it('renders each rule with description, message and predicates', () => {
    render(<RulesTable rules={config.rules} />)
    expect(screen.getByText('submit-requires-supplier-contact')).toBeInTheDocument()
    expect(
      screen.getByText('Submitting an estimate requires a supplier contact.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Supplier Contact is required to submit this estimate.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Fires when ALL of:')).toBeInTheDocument()
  })

  it('renders an empty state when there are no rules', () => {
    render(<RulesTable rules={[]} />)
    expect(screen.getByText('No rules')).toBeInTheDocument()
  })
})

describe('RawJsonView', () => {
  it('renders the full config as pretty JSON', () => {
    render(<RawJsonView config={config} />)
    expect(screen.getByText(/"integrationId": "demo_partner"/)).toBeInTheDocument()
    // Corpus is included in the raw view (but not the human-readable tabs).
    expect(screen.getByText(/"corpus"/)).toBeInTheDocument()
  })
})
