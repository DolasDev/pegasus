// ---------------------------------------------------------------------------
// /automations index tests — the all-user read-only view. Lists only this
// tenant's OWN automations (visibility TENANT), one row per name pointing at the
// latest version. The platform library (GLOBAL) belongs to Settings →
// Automations, not here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AutomationsIndexPage } from '../routes/automations.index'
import type { Workflow } from '../api/workflows'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={to.replace('$workflowId', params?.workflowId ?? '')} {...rest}>
      {children}
    </a>
  ),
}))

let listReturn: Record<string, unknown> = { data: [], isLoading: false, isError: false }
let summaryReturn: Record<string, unknown> = { data: undefined }

// The page makes two queries: the workflow list and the requirements summary
// (whose `current` flag marks an older version an enabled trigger still runs).
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly string[] }) =>
      queryKey.includes('requirements-summary') ? summaryReturn : listReturn,
  }
})

function wf(over: Partial<Workflow> & Pick<Workflow, 'id' | 'name' | 'version'>): Workflow {
  return {
    tenantId: 't-1',
    visibility: 'TENANT',
    manifest: {
      name: over.name,
      version: over.version,
      description: `${over.name} description`,
    } as Workflow['manifest'],
    createdByUserId: 'u-1',
    artifactSha256: 'abc',
    executable: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...over,
  }
}

const ownV1 = wf({ id: 'w-own-1', name: 'pulse-texting', version: '1.0.0' })
const ownV2 = wf({
  id: 'w-own-2',
  name: 'pulse-texting',
  version: '1.1.0',
  createdAt: '2026-11-05T00:00:00Z',
})
const ownOther = wf({ id: 'w-other', name: 'nightly-sync', version: '0.3.0', executable: false })
const platform = wf({
  id: 'w-global',
  name: 'stdlib-template',
  version: '2.0.0',
  visibility: 'GLOBAL',
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AutomationsIndexPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listReturn = { data: [ownV1, ownV2, ownOther, platform], isLoading: false, isError: false }
  summaryReturn = { data: undefined }
})

function summaryRow(workflowId: string, version: string, current: boolean) {
  return {
    workflowId,
    name: 'pulse-texting',
    version,
    visibility: 'TENANT',
    current,
    requirements: [],
    missingCount: 0,
  }
}

describe('AutomationsIndexPage', () => {
  it("lists the tenant's own automations and hides the platform library", () => {
    renderPage()
    expect(screen.getByText('Your automations')).toBeInTheDocument()
    expect(screen.getByText('pulse-texting')).toBeInTheDocument()
    expect(screen.getByText('nightly-sync')).toBeInTheDocument()
    expect(screen.queryByText('stdlib-template')).not.toBeInTheDocument()
  })

  it('collapses versions into one row that links to the latest version', () => {
    renderPage()
    const row = screen.getByText('pulse-texting').closest('a')
    expect(row?.getAttribute('href')).toBe('/automations/w-own-2')
    expect(screen.getByText('v1.1.0')).toBeInTheDocument()
  })

  it('keeps earlier versions reachable, since their executions are their own', () => {
    renderPage()
    expect(screen.getByText('Earlier versions:')).toBeInTheDocument()
    const older = screen.getByText('v1.0.0').closest('a')
    expect(older?.getAttribute('href')).toBe('/automations/w-own-1')
    // No summary → no marker, but the link still renders.
    expect(screen.queryByText('Still triggered')).not.toBeInTheDocument()
  })

  it('marks an earlier version that an enabled trigger still runs', () => {
    summaryReturn = {
      data: {
        workflows: [summaryRow('w-own-2', '1.1.0', true), summaryRow('w-own-1', '1.0.0', true)],
        totalMissing: 0,
      },
    }
    renderPage()
    const older = screen.getByText('v1.0.0').closest('a')
    expect(older?.textContent).toContain('Still triggered')
    // The marker is for earlier versions only — the latest row doesn't get one.
    expect(screen.getAllByText('Still triggered')).toHaveLength(1)
  })

  it('does not mark a superseded earlier version with no live trigger', () => {
    summaryReturn = {
      data: {
        workflows: [summaryRow('w-own-2', '1.1.0', true), summaryRow('w-own-1', '1.0.0', false)],
        totalMissing: 0,
      },
    }
    renderPage()
    expect(screen.queryByText('Still triggered')).not.toBeInTheDocument()
  })

  it('shows executability so a viewer can spot a broken automation', () => {
    renderPage()
    expect(screen.getByText('Executable')).toBeInTheDocument()
    expect(screen.getByText('Not executable')).toBeInTheDocument()
  })

  it('shows the empty state when the tenant has only platform automations', () => {
    listReturn = { data: [platform], isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText('No automations yet')).toBeInTheDocument()
  })

  it('surfaces a failed load', () => {
    listReturn = { data: undefined, isLoading: false, isError: true }
    renderPage()
    expect(screen.getByText('Failed to load automations.')).toBeInTheDocument()
  })
})
