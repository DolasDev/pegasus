// ---------------------------------------------------------------------------
// Settings → Developer → Configs panel tests.
//
// Covers the variable cross-reference the page is built around: "Used by" on
// stored rows, the key-centric missing list and its prefill, the kind-gated Add
// button, and the delete dialog naming who will break. Pattern mirrors
// developer-integrations.test.tsx — router primitives and the query/mutation
// hooks are mocked so the panel mounts without a RouterProvider.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { WorkflowSecretsConfigsPanel } from '../features/settings/WorkflowSecretsConfigs'
import type { WorkflowSecretMeta, WorkflowConfigEntry } from '../api/workflow-secrets-configs'
import type { WorkflowRequirementsSummary } from '../api/workflows'
import type { IntegrationRequirementsSummary } from '../api/integrations'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: { to: string; params?: Record<string, string>; children: ReactNode } & Record<
    string,
    unknown
  >) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { mockCreateSecret, mockDeleteSecret, mockCreateConfig, mockUpsertConfig, mockDeleteConfig } =
  vi.hoisted(() => {
    const mutation = () => ({ mutate: vi.fn(), isPending: false })
    return {
      mockCreateSecret: mutation(),
      mockDeleteSecret: mutation(),
      mockCreateConfig: mutation(),
      mockUpsertConfig: mutation(),
      mockDeleteConfig: mutation(),
    }
  })

vi.mock('@/api/queries/workflow-secrets-configs', () => ({
  secretsQueryOptions: { queryKey: ['workflow-secrets-configs', 'secrets'] },
  configsQueryOptions: { queryKey: ['workflow-secrets-configs', 'configs'] },
  useCreateSecret: () => mockCreateSecret,
  useDeleteSecret: () => mockDeleteSecret,
  useCreateConfig: () => mockCreateConfig,
  useUpsertConfig: () => mockUpsertConfig,
  useDeleteConfig: () => mockDeleteConfig,
}))

vi.mock('@/api/queries/workflows', () => ({
  workflowRequirementsSummaryQueryOptions: {
    queryKey: ['workflows', 'requirements-summary'],
  },
}))

vi.mock('@/api/queries/integrations', () => ({
  integrationRequirementsSummaryQueryOptions: {
    queryKey: ['integrations', 'requirements-summary'],
  },
}))

let permissions = new Set<string>(['workflow_secret:manage', 'workflow_config:manage'])

vi.mock('@/auth/permissions', () => ({
  usePermissions: () => ({
    isLoading: false,
    has: (p: string) => permissions.has(p),
    allOf: (ps: readonly string[]) => ps.every((p) => permissions.has(p)),
    anyOf: (ps: readonly string[]) => ps.some((p) => permissions.has(p)),
    permissions,
    roles: [],
    hasCapability: () => true,
  }),
}))

let secrets: WorkflowSecretMeta[] = []
let configs: WorkflowConfigEntry[] = []
let workflowSummary: WorkflowRequirementsSummary | undefined
let integrationSummary: IntegrationRequirementsSummary | undefined

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (opts: { queryKey?: unknown[] }) => {
      const key = Array.isArray(opts?.queryKey) ? opts.queryKey : []
      if (key.includes('requirements-summary')) {
        return { data: key.includes('workflows') ? workflowSummary : integrationSummary }
      }
      const data = key.includes('secrets') ? secrets : configs
      return { data, isPending: false, isError: false, error: null }
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function secretRow(key: string, group = 'global'): WorkflowSecretMeta {
  return {
    id: `sec-${group}-${key}`,
    group,
    key,
    description: null,
    isSecret: true,
    createdByUserId: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function configRow(key: string, value: string, group = 'global'): WorkflowConfigEntry {
  return {
    id: `cfg-${group}-${key}`,
    group,
    key,
    value,
    description: null,
    isSecret: false,
    createdByUserId: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

type Req = WorkflowRequirementsSummary['workflows'][number]['requirements'][number]

function req(kind: 'SECRET' | 'CONFIG', key: string, over: Partial<Req> = {}): Req {
  return { kind, key, group: 'global', description: null, present: true, ...over }
}

function wfSummary(
  ...rows: Array<{ id: string; name: string; requirements: Req[] }>
): WorkflowRequirementsSummary {
  return {
    workflows: rows.map((r) => ({
      workflowId: r.id,
      name: r.name,
      version: '1.0.0',
      visibility: 'TENANT' as const,
      requirements: r.requirements,
      missingCount: r.requirements.filter((x) => !x.present).length,
    })),
    totalMissing: 0,
  }
}

function intgSummary(
  ...rows: Array<{ id: string; name: string; requirements: Req[] }>
): IntegrationRequirementsSummary {
  return {
    integrations: rows.map((r) => ({
      integrationId: r.id,
      displayName: r.name,
      requirements: r.requirements,
      missingCount: r.requirements.filter((x) => !x.present).length,
    })),
    totalMissing: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions = new Set(['workflow_secret:manage', 'workflow_config:manage'])
  secrets = []
  configs = []
  workflowSummary = undefined
  integrationSummary = undefined
})

// ---------------------------------------------------------------------------

describe('Configs panel — "used by" cross-reference', () => {
  it('names the workflows and integrations that read a stored secret', () => {
    secrets = [secretRow('STRIPE_API_KEY')]
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'nightly-sync',
      requirements: [req('SECRET', 'STRIPE_API_KEY')],
    })
    integrationSummary = intgSummary({
      id: 'sirva',
      name: 'Sirva ADE',
      requirements: [req('SECRET', 'STRIPE_API_KEY')],
    })

    render(<WorkflowSecretsConfigsPanel />)

    const row = screen.getByText('STRIPE_API_KEY').closest('div') as HTMLElement
    expect(within(row).getByText(/Used by/)).toBeTruthy()
    expect(within(row).getByText('nightly-sync')).toBeTruthy()
    expect(within(row).getByText('Sirva ADE')).toBeTruthy()
  })

  it('names a workflow once even when every version declares the key', () => {
    // The summary returns one row per VERSION, each with its own id.
    secrets = [secretRow('STRIPE_API_KEY')]
    workflowSummary = wfSummary(
      { id: 'wf-v1', name: 'nightly-sync', requirements: [req('SECRET', 'STRIPE_API_KEY')] },
      { id: 'wf-v2', name: 'nightly-sync', requirements: [req('SECRET', 'STRIPE_API_KEY')] },
      { id: 'wf-v3', name: 'nightly-sync', requirements: [req('SECRET', 'STRIPE_API_KEY')] },
    )

    render(<WorkflowSecretsConfigsPanel />)

    expect(screen.getAllByText('nightly-sync')).toHaveLength(1)
  })

  it('does not cross-label a config with a same-named secret requirement', () => {
    configs = [configRow('API_KEY', 'plain')]
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'secret-reader',
      requirements: [req('SECRET', 'API_KEY')],
    })

    render(<WorkflowSecretsConfigsPanel />)

    expect(screen.queryByText('secret-reader')).toBeNull()
  })

  it('renders without annotations when the summaries cannot be read', () => {
    secrets = [secretRow('STRIPE_API_KEY')]

    render(<WorkflowSecretsConfigsPanel />)

    expect(screen.getByText('STRIPE_API_KEY')).toBeTruthy()
    expect(screen.queryByText(/Used by/)).toBeNull()
  })
})

describe('Configs panel — missing variables', () => {
  it('lists one row per missing key with who needs it', () => {
    workflowSummary = wfSummary(
      {
        id: 'wf1',
        name: 'alpha',
        requirements: [req('SECRET', 'VENDOR_TOKEN', { present: false })],
      },
      {
        id: 'wf2',
        name: 'beta',
        requirements: [req('SECRET', 'VENDOR_TOKEN', { present: false })],
      },
    )

    render(<WorkflowSecretsConfigsPanel />)

    expect(screen.getByText('1 key declared but not set')).toBeTruthy()
    const item = screen.getByText('VENDOR_TOKEN').closest('li') as HTMLElement
    expect(within(item).getByText(/Needed by/)).toBeTruthy()
    expect(within(item).getByText('alpha')).toBeTruthy()
    expect(within(item).getByText('beta')).toBeTruthy()
  })

  it('prefills the secret form when Add is clicked, leaving only the value', () => {
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'alpha',
      requirements: [
        req('SECRET', 'VENDOR_TOKEN', {
          present: false,
          group: 'billing',
          description: 'Vendor bearer token',
        }),
      ],
    })

    render(<WorkflowSecretsConfigsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('VENDOR_TOKEN')
    expect((screen.getByLabelText('Group') as HTMLInputElement).value).toBe('billing')
    expect((screen.getByLabelText('Description (optional)') as HTMLInputElement).value).toBe(
      'Vendor bearer token',
    )
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('')

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk_live_x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create secret' }))

    expect(mockCreateSecret.mutate).toHaveBeenCalledWith(
      {
        key: 'VENDOR_TOKEN',
        value: 'sk_live_x',
        group: 'billing',
        description: 'Vendor bearer token',
      },
      expect.anything(),
    )
  })

  it('re-prefills when a second missing key is added', () => {
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'alpha',
      requirements: [
        req('SECRET', 'FIRST_TOKEN', { present: false }),
        req('SECRET', 'SECOND_TOKEN', { present: false }),
      ],
    })

    render(<WorkflowSecretsConfigsPanel />)
    const addButtons = screen.getAllByRole('button', { name: /^Add$/ })
    fireEvent.click(addButtons[0]!)
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('FIRST_TOKEN')

    fireEvent.click(addButtons[1]!)
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('SECOND_TOKEN')
  })

  it('routes a missing CONFIG to the config form', () => {
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'alpha',
      requirements: [req('CONFIG', 'DEFAULT_REGION', { present: false })],
    })

    render(<WorkflowSecretsConfigsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('DEFAULT_REGION')
    // The config form is the one that opened — it has no Description field.
    expect(screen.queryByLabelText('Description (optional)')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create config' })).toBeTruthy()
  })

  it('offers Add only for the kind the user can manage', () => {
    permissions = new Set(['workflow_config:manage'])
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'alpha',
      requirements: [
        req('SECRET', 'VENDOR_TOKEN', { present: false }),
        req('CONFIG', 'DEFAULT_REGION', { present: false }),
      ],
    })

    render(<WorkflowSecretsConfigsPanel />)

    // Both keys are still listed — only the config one is actionable.
    expect(screen.getByText('VENDOR_TOKEN')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Add$/ })).toHaveLength(1)
    const configItem = screen.getByText('DEFAULT_REGION').closest('li') as HTMLElement
    expect(within(configItem).getByRole('button', { name: /^Add$/ })).toBeTruthy()
  })

  it('stays silent when every declared key is set', () => {
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'alpha',
      requirements: [req('SECRET', 'VENDOR_TOKEN')],
    })

    render(<WorkflowSecretsConfigsPanel />)

    expect(screen.queryByText(/declared but not set/)).toBeNull()
  })
})

describe('Configs panel — delete blast radius', () => {
  it('names the consumers that will break', () => {
    configs = [configRow('DEFAULT_REGION', 'us-east-1')]
    workflowSummary = wfSummary({
      id: 'wf1',
      name: 'nightly-sync',
      requirements: [req('CONFIG', 'DEFAULT_REGION')],
    })
    integrationSummary = intgSummary({
      id: 'sirva',
      name: 'Sirva ADE',
      requirements: [req('CONFIG', 'DEFAULT_REGION')],
    })

    render(<WorkflowSecretsConfigsPanel />)
    const row = screen.getByText('DEFAULT_REGION').closest('div') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[1]!)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/2 consumers declare this key/)).toBeTruthy()
    expect(within(dialog).getByText('nightly-sync, Sirva ADE')).toBeTruthy()
  })

  it('omits the warning when nothing declares the key', () => {
    configs = [configRow('ORPHAN', 'x')]

    render(<WorkflowSecretsConfigsPanel />)
    const row = screen.getByText('ORPHAN').closest('div') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[1]!)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(/declare this key/)).toBeNull()
  })
})
