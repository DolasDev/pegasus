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
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import {
  IntegrationDetailPage,
  MappingTable,
  RulesTable,
  RawJsonView,
  GateReportView,
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

const { mockFork, mockValidate, mockPublish, mockRollback } = vi.hoisted(() => ({
  mockFork: { mutate: vi.fn(), isPending: false, error: null as unknown },
  mockValidate: { mutate: vi.fn(), isPending: false, error: null as unknown },
  mockPublish: { mutate: vi.fn(), isPending: false, error: null as unknown },
  mockRollback: { mutate: vi.fn(), isPending: false, error: null as unknown },
}))

vi.mock('@/api/queries/integrations', () => ({
  integrationConfigQueryOptions: (id: string) => ({
    queryKey: ['integrations', 'config', id],
    queryFn: vi.fn(),
  }),
  integrationConfigVersionsQueryOptions: (id: string) => ({
    queryKey: ['integrations', 'versions', id],
    queryFn: vi.fn(),
  }),
  integrationRequirementsSummaryQueryOptions: {
    queryKey: ['integrations', 'requirements-summary'],
    queryFn: vi.fn(),
  },
  useForkIntegrationConfig: () => mockFork,
  useValidateIntegrationConfig: () => mockValidate,
  usePublishIntegrationConfig: () => mockPublish,
  useRollbackIntegrationConfig: () => mockRollback,
}))

let configReturn: Record<string, unknown> = { data: undefined, isLoading: true, isError: false }
let requirementsReturn: Record<string, unknown> = {
  data: undefined,
  isLoading: false,
  isError: false,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    // The versions query (ConfigVersionsCard) returns an empty list; the
    // requirements-summary query returns its controllable return; every other
    // query resolves to the controllable config return.
    useQuery: (opts: { queryKey?: unknown[] }) => {
      const key = Array.isArray(opts?.queryKey) ? opts.queryKey : []
      if (key.includes('versions')) return { data: [], isLoading: false, isError: false }
      if (key.includes('requirements-summary')) return requirementsReturn
      return configReturn
    },
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
  forkedFromConfigId: null,
  forkedFromVersion: null,
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
    requirementsReturn = { data: undefined, isLoading: false, isError: false }
  })

  it('renders the required secrets/configs card with present/missing badges', () => {
    configReturn = { data: config, isLoading: false, isError: false }
    requirementsReturn = {
      data: {
        integrations: [
          {
            integrationId: 'demo_partner',
            displayName: 'Demo Partner',
            missingCount: 1,
            requirements: [
              {
                kind: 'SECRET',
                key: 'SEND_API_KEY',
                group: 'demo',
                description: null,
                present: true,
              },
              {
                kind: 'CONFIG',
                key: 'SEND_URL',
                group: 'global',
                description: null,
                present: false,
              },
            ],
          },
        ],
        totalMissing: 1,
      },
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByText('SEND_API_KEY')).toBeInTheDocument()
    expect(screen.getByText('SEND_URL')).toBeInTheDocument()
    expect(screen.getByText(/1 value not yet set/i)).toBeInTheDocument()
  })

  it('hides the required-values card when the integration declares none', () => {
    configReturn = { data: config, isLoading: false, isError: false }
    requirementsReturn = {
      data: { integrations: [], totalMissing: 0 },
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.queryByText(/secrets & configuration/i)).not.toBeInTheDocument()
  })

  it('shows a Fork button on a GLOBAL (platform) config and forks on click', () => {
    configReturn = { data: config, isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText('Platform')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /fork to my tenant/i })
    fireEvent.click(btn)
    expect(mockFork.mutate).toHaveBeenCalledWith('demo_partner')
    // No Edit affordance for a platform config the tenant doesn't own.
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('shows provenance + Edit (not Fork) on a TENANT-owned forked config', () => {
    configReturn = {
      data: { ...config, visibility: 'TENANT', forkedFromVersion: 3, forkedFromConfigId: 'cfg-g' },
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByText(/forked from platform v3/i)).toBeInTheDocument()
    expect(screen.getByText('Your config')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fork to my tenant/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })

  it('opens the editor when Edit is clicked on a TENANT config', () => {
    configReturn = {
      data: { ...config, visibility: 'TENANT' },
      isLoading: false,
      isError: false,
    }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByText('Mapping (JSON)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument()
    // Publish is blocked until a validate passes.
    expect(screen.getByRole('button', { name: /publish new version/i })).toBeDisabled()
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
    // A GLOBAL config renders the "Platform" badge (+ a Fork CTA).
    expect(screen.getByText('Platform')).toBeInTheDocument()
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

describe('GateReportView', () => {
  it('summarizes a passing gate', () => {
    render(
      <GateReportView
        report={{ ok: true, problems: [], corpus: { total: 2, passed: 2, failures: [] } }}
      />,
    )
    expect(screen.getByText(/gate passed — 2\/2 corpus cases/i)).toBeInTheDocument()
  })

  it('lists problems on a failing gate', () => {
    render(
      <GateReportView
        report={{
          ok: false,
          problems: [{ stage: 'mapping', where: 'shipments', problem: 'unmapped' }],
          corpus: { total: 1, passed: 0, failures: [] },
        }}
      />,
    )
    expect(screen.getByText(/gate failed — 1 problem/i)).toBeInTheDocument()
    expect(screen.getByText(/\[mapping\] shipments: unmapped/i)).toBeInTheDocument()
  })
})
