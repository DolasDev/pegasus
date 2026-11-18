// ---------------------------------------------------------------------------
// /workflows and /workflows/$executionId — the durable Workflow instances.
//
// The API module is mocked; TanStack Query is real, so refetch-on-focus and
// the 15 s row re-read actually run. The load-bearing check: the
// @workflow.query (which wakes the tenant's runner) runs once on open and on
// Refresh, and NEVER on a timer or a focus refetch.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import type { WorkflowInstance, WorkflowInstanceDetail } from '@/api/workflow-executions'

const api = vi.hoisted(() => ({
  listWorkflowInstances: vi.fn(),
  getWorkflowInstance: vi.fn(),
  getWorkflowInstanceHistory: vi.fn(),
  queryWorkflowInstance: vi.fn(),
  cancelWorkflowInstance: vi.fn(),
  terminateWorkflowInstance: vi.fn(),
}))
vi.mock('@/api/workflow-executions', () => api)

// The name dropdown is filled from the tenant's published Workflow versions.
const { mockListWorkflows } = vi.hoisted(() => ({ mockListWorkflows: vi.fn() }))
vi.mock('@/api/workflows', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorkflows: mockListWorkflows,
}))
const version = (name: string, kind: 'WORKFLOW' | 'AUTOMATION', id = `${name}-${kind}`) => ({
  id,
  name,
  version: '1.0.0',
  kind,
  visibility: 'TENANT',
})

let permissions: string[] = []
vi.mock('@/auth/permissions', () => ({
  usePermissions: () => ({
    isLoading: false,
    has: (p: string) => permissions.includes(p),
  }),
}))

const EXEC_ID = 'exec-1'
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ executionId: EXEC_ID }),
  Link: ({
    to,
    params,
    children,
    search: _search,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: unknown
    children: ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

import { WorkflowsIndexPage } from '../routes/workflows.index'
import { WorkflowInstancePage } from '../routes/workflows.$executionId'

const DEV = [
  'workflow:query_execution',
  'workflow:cancel_execution',
  'workflow:terminate_execution',
]

function instance(over: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: EXEC_ID,
    tenantId: 't-1',
    workflowId: 'wf-v1',
    workflowName: 'order_lifecycle',
    workflowVersion: '1.1.0',
    kind: 'WORKFLOW',
    correlationKey: 'o-42',
    status: 'RUNNING',
    input: { orderId: 'o-42' },
    result: null,
    errorMessage: null,
    temporalWorkflowId: 'wfl/t-1/order_lifecycle/o-42',
    temporalRunId: 'r1',
    triggeredByUserId: null,
    triggerSource: 'EVENT',
    triggeredByTriggerId: 'trg-1',
    parentExecutionId: null,
    dryRun: false,
    queuedAt: '2026-11-17T10:00:00Z',
    startedAt: '2026-11-17T10:00:01Z',
    finishedAt: null,
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-17T10:05:00Z',
    ...over,
  }
}

function detail(over: Partial<WorkflowInstanceDetail> = {}): WorkflowInstanceDetail {
  return { ...instance(), signals: ['order_event'], queries: ['status', 'history'], ...over }
}

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  permissions = [...DEV]
  api.getWorkflowInstance.mockResolvedValue(detail())
  api.getWorkflowInstanceHistory.mockResolvedValue([
    { id: '1', type: 'WorkflowExecutionStarted', timestamp: '2026-11-17T10:00:01Z' },
    {
      id: '5',
      type: 'WorkflowExecutionSignaled',
      timestamp: '2026-11-17T10:03:00Z',
      signalName: 'order_event',
    },
  ])
  api.listWorkflowInstances.mockResolvedValue({ data: [], limit: 200 })
  api.queryWorkflowInstance.mockResolvedValue({ stage: 'packing' })
  mockListWorkflows.mockReset()
  mockListWorkflows.mockResolvedValue([
    version('order_lifecycle', 'WORKFLOW', 'v1'),
    version('order_lifecycle', 'WORKFLOW', 'v2'),
    version('claim_followup', 'WORKFLOW'),
    version('send_quote_followup', 'AUTOMATION'),
  ])
})

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

// ── /workflows ───────────────────────────────────────────────────────────────

describe('WorkflowsIndexPage', () => {
  it('lists open Workflows by default, with the key or "manual"', async () => {
    api.listWorkflowInstances.mockResolvedValue({
      data: [instance(), instance({ id: 'exec-2', correlationKey: null })],
      limit: 50,
    })
    renderWith(<WorkflowsIndexPage />)
    expect(await screen.findByText('o-42')).toBeInTheDocument()
    expect(screen.getByText(/Key:\s*manual/)).toBeInTheDocument()
    expect(api.listWorkflowInstances).toHaveBeenCalledWith({
      kind: 'WORKFLOW',
      open: true,
      limit: 50,
    })
    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/workflows/exec-1')
    expect(links).toHaveLength(1)
  })

  it('offers the published durable Workflow names (not Automations) in a dropdown', async () => {
    renderWith(<WorkflowsIndexPage />)
    const select = await screen.findByLabelText('Workflow')
    await vi.waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All Workflows', 'claim_followup', 'order_lifecycle']),
    )
  })

  it('applies the chosen name at once; the key and Open/All go along as query params', async () => {
    api.listWorkflowInstances.mockResolvedValue({ data: [], limit: 50 })
    renderWith(<WorkflowsIndexPage />)
    await screen.findByText('No open Workflows')
    const select = screen.getByLabelText('Workflow')
    await within(select).findByRole('option', { name: 'order_lifecycle' })

    expect(screen.getByLabelText('Key')).toBeDisabled()
    fireEvent.change(select, { target: { value: 'order_lifecycle' } })
    await vi.waitFor(() =>
      expect(api.listWorkflowInstances).toHaveBeenLastCalledWith({
        kind: 'WORKFLOW',
        open: true,
        name: 'order_lifecycle',
        limit: 50,
      }),
    )

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'o-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    await vi.waitFor(() =>
      expect(api.listWorkflowInstances).toHaveBeenLastCalledWith({
        kind: 'WORKFLOW',
        open: true,
        name: 'order_lifecycle',
        correlationKey: 'o-7',
        limit: 50,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await vi.waitFor(() =>
      expect(api.listWorkflowInstances).toHaveBeenLastCalledWith(
        expect.objectContaining({ open: false, name: 'order_lifecycle', correlationKey: 'o-7' }),
      ),
    )
    expect(await screen.findByText('No Workflows')).toBeInTheDocument()

    // Back to "All Workflows" drops the name and the key.
    fireEvent.change(select, { target: { value: '' } })
    await vi.waitFor(() =>
      expect(api.listWorkflowInstances).toHaveBeenLastCalledWith({
        kind: 'WORKFLOW',
        open: false,
        limit: 50,
      }),
    )
    expect(screen.getByLabelText('Key')).toBeDisabled()
  })

  it('keeps a name that only a listed instance carries (e.g. every version retired)', async () => {
    mockListWorkflows.mockResolvedValue([])
    api.listWorkflowInstances.mockResolvedValue({
      data: [instance({ workflowName: 'legacy_flow' })],
      limit: 50,
    })
    renderWith(<WorkflowsIndexPage />)
    const select = await screen.findByLabelText('Workflow')
    expect(await within(select).findByRole('option', { name: 'legacy_flow' })).toBeInTheDocument()
  })

  it('says so when the tenant has no durable Workflows published', async () => {
    mockListWorkflows.mockResolvedValue([version('send_quote_followup', 'AUTOMATION')])
    renderWith(<WorkflowsIndexPage />)
    expect(
      await screen.findByText(/no durable workflows are published in this tenant/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Workflow')).toBeDisabled()
  })

  it('pages with "Load more" using the last row as the cursor', async () => {
    api.listWorkflowInstances
      .mockResolvedValueOnce({ data: [instance({ id: 'a' }), instance({ id: 'b' })], limit: 2 })
      .mockResolvedValueOnce({ data: [instance({ id: 'c' })], limit: 2 })
    renderWith(<WorkflowsIndexPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await vi.waitFor(() =>
      expect(api.listWorkflowInstances).toHaveBeenLastCalledWith(
        expect.objectContaining({ before: 'b' }),
      ),
    )
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    )
  })
})

// ── /workflows/$executionId ─────────────────────────────────────────────────

describe('WorkflowInstancePage', () => {
  it('runs the status query once on open and shows the answer', async () => {
    renderWith(<WorkflowInstancePage />)
    expect(await screen.findByLabelText('status result')).toHaveTextContent('packing')
    expect(api.queryWorkflowInstance).toHaveBeenCalledTimes(1)
    expect(api.queryWorkflowInstance).toHaveBeenCalledWith(
      EXEC_ID,
      'status',
      [],
      expect.any(AbortSignal),
    )
  })

  it('never polls the query: row re-reads and focus refetches leave it at one call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWith(<WorkflowInstancePage />)
    await screen.findByLabelText('status result')
    const rowReadsBefore = api.getWorkflowInstance.mock.calls.length

    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    // The stored row IS re-read (every 15 s while open)…
    expect(api.getWorkflowInstance.mock.calls.length).toBeGreaterThan(rowReadsBefore + 10)
    // …but the runner-waking query ran exactly once.
    expect(api.queryWorkflowInstance).toHaveBeenCalledTimes(1)
  })

  it('Refresh runs the status query again', async () => {
    renderWith(<WorkflowInstancePage />)
    await screen.findByLabelText('status result')
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await vi.waitFor(() => expect(api.queryWorkflowInstance).toHaveBeenCalledTimes(2))
  })

  it('shows "Waking the runner" on 503 WORKFLOW_WORKER_STARTING, then the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.queryWorkflowInstance
      .mockRejectedValueOnce(new ApiError('starting', 'WORKFLOW_WORKER_STARTING', 503, 15))
      .mockResolvedValueOnce({ stage: 'delivered' })
    renderWith(<WorkflowInstancePage />)
    expect(await screen.findByText(/waking the runner/i)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(await screen.findByLabelText('status result')).toHaveTextContent('delivered')
    expect(api.queryWorkflowInstance).toHaveBeenCalledTimes(2)
  })

  it('lists delivered signals from the history', async () => {
    renderWith(<WorkflowInstancePage />)
    const list = await screen.findByRole('list', { name: 'Delivered signals' })
    expect(within(list).getByText('order_event')).toBeInTheDocument()
    expect(within(list).queryByText('WorkflowExecutionStarted')).not.toBeInTheDocument()
    expect(api.getWorkflowInstanceHistory).toHaveBeenCalledWith('wf-v1', EXEC_ID)
  })

  it('lists the steps this instance started, each linking to its Automation', async () => {
    api.listWorkflowInstances.mockResolvedValue({
      data: [
        instance({
          id: 'step-1',
          workflowId: 'auto-1',
          workflowName: 'send_quote_followup',
          workflowVersion: '0.2.0',
          kind: 'AUTOMATION',
          status: 'COMPLETED',
          parentExecutionId: EXEC_ID,
        }),
      ],
      limit: 200,
    })
    renderWith(<WorkflowInstancePage />)
    const steps = await screen.findByRole('list', { name: 'Steps' })
    const link = within(steps).getByRole('link')
    expect(link).toHaveTextContent('send_quote_followup')
    expect(link.getAttribute('href')).toBe('/automations/auto-1')
    expect(api.listWorkflowInstances).toHaveBeenCalledWith({
      parentExecutionId: EXEC_ID,
      limit: 200,
    })
  })

  it('a viewer sees no query, no actions, and the developer-role hint', async () => {
    permissions = []
    renderWith(<WorkflowInstancePage />)
    expect(await screen.findByText(/live status needs the developer role/i)).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Delivered signals' })
    expect(api.queryWorkflowInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /terminate/i })).not.toBeInTheDocument()
  })

  it('a closed instance runs no query and offers no actions', async () => {
    api.getWorkflowInstance.mockResolvedValue(
      detail({ status: 'COMPLETED', finishedAt: '2026-11-17T11:00:00Z' }),
    )
    renderWith(<WorkflowInstancePage />)
    expect(await screen.findByText(/this workflow is closed/i)).toBeInTheDocument()
    expect(api.queryWorkflowInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /terminate/i })).not.toBeInTheDocument()
  })

  it('terminate requires a reason and sends it', async () => {
    api.terminateWorkflowInstance.mockResolvedValue(instance({ status: 'CANCELLED' }))
    renderWith(<WorkflowInstancePage />)
    fireEvent.click(await screen.findByRole('button', { name: /terminate…/i }))
    const confirm = screen.getByRole('button', { name: 'Terminate Workflow' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: '  order voided ' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await vi.waitFor(() =>
      expect(api.terminateWorkflowInstance).toHaveBeenCalledWith(EXEC_ID, 'order voided'),
    )
  })

  it('cancel asks for confirmation first', async () => {
    api.cancelWorkflowInstance.mockResolvedValue(instance())
    renderWith(<WorkflowInstancePage />)
    fireEvent.click(await screen.findByRole('button', { name: /cancel…/i }))
    expect(api.cancelWorkflowInstance).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Workflow' }))
    await vi.waitFor(() => expect(api.cancelWorkflowInstance).toHaveBeenCalledWith(EXEC_ID))
  })
})
