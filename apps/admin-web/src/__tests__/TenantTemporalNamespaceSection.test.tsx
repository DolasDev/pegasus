import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TenantTemporalNamespaceSection } from '../components/TenantTemporalNamespaceSection'
import type { TemporalNamespace } from '../api/temporal-namespace'

vi.mock('@/api/temporal-namespace', () => ({
  getTemporalNamespace: vi.fn(),
  provisionTemporalNamespace: vi.fn(),
  rotateTemporalNamespaceKey: vi.fn(),
  deprovisionTemporalNamespace: vi.fn(),
  cutoverTemporalNamespace: vi.fn(),
  rollbackTemporalNamespace: vi.fn(),
}))
vi.mock('@/auth/cognito', () => ({ getAccessToken: () => 'tok-123' }))
vi.mock('@/config', () => ({ getConfig: () => ({ apiUrl: 'https://api.test' }) }))

import {
  getTemporalNamespace,
  provisionTemporalNamespace,
  rotateTemporalNamespaceKey,
  deprovisionTemporalNamespace,
  cutoverTemporalNamespace,
  rollbackTemporalNamespace,
} from '@/api/temporal-namespace'

const TENANT = 'a90b22bc-4393-4ccc-8ddd-eeeeeeeeffff'

function ns(overrides: Partial<TemporalNamespace> = {}): TemporalNamespace {
  return {
    tenantId: TENANT,
    namespace: 'pg-staging-a90b22bc4393.chgel',
    grpcAddress: 'pg-staging-a90b22bc4393.chgel.tmprl.cloud:7233',
    status: 'READY',
    step: 'ready',
    busy: false,
    lastError: null,
    apiKeyExpiresAt: '2027-10-05T12:00:00.000Z',
    previousKeyRetireAt: null,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
    ...overrides,
  }
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TenantTemporalNamespaceSection tenantId={TENANT} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantTemporalNamespaceSection', () => {
  it('says provisioning is not configured and disables the button', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: null,
      configured: false,
      scopedRunnerConfigured: false,
    })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-not-configured')).toHaveTextContent(
      'Temporal namespace provisioning is not configured for this environment',
    )
    expect(screen.getByRole('button', { name: 'Provision namespace' })).toBeDisabled()
  })

  it('provisions a tenant with no namespace', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: null,
      configured: true,
      scopedRunnerConfigured: true,
    })
    vi.mocked(provisionTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'PROVISIONING', step: null }),
    })
    renderSection()
    const button = await screen.findByRole('button', { name: 'Provision namespace' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(provisionTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('shows a READY namespace with Rotate key and Deprovision', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns(),
      configured: true,
      scopedRunnerConfigured: true,
    })
    vi.mocked(rotateTemporalNamespaceKey).mockResolvedValue({ data: ns() })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-status')).toHaveTextContent('Ready')
    expect(screen.getByTestId('temporal-namespace-name')).toHaveTextContent(
      'pg-staging-a90b22bc4393.chgel',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    await waitFor(() => expect(rotateTemporalNamespaceKey).toHaveBeenCalledWith(TENANT))
  })

  it('asks for confirmation in the page before deprovisioning', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns(),
      configured: true,
      scopedRunnerConfigured: true,
    })
    vi.mocked(deprovisionTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'DEPROVISIONING' }),
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Deprovision' }))
    expect(deprovisionTemporalNamespace).not.toHaveBeenCalled()
    expect(screen.getByTestId('temporal-namespace-confirm-deprovision')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('temporal-namespace-confirm-deprovision')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Deprovision' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, deprovision' }))
    await waitFor(() => expect(deprovisionTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('shows the error and a retry on a FAILED namespace, and no rotate', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'FAILED', lastError: 'CloudOpsAuthError: denied' }),
      configured: true,
      scopedRunnerConfigured: true,
    })
    vi.mocked(provisionTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'PROVISIONING' }),
    })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-last-error')).toHaveTextContent(
      'CloudOpsAuthError: denied',
    )
    expect(screen.queryByRole('button', { name: 'Rotate key' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry provisioning' }))
    await waitFor(() => expect(provisionTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('disables actions while a provisioner run holds the row', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'FAILED', busy: true }),
      configured: true,
      scopedRunnerConfigured: true,
    })
    renderSection()
    expect(await screen.findByRole('button', { name: 'Retry provisioning' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deprovision' })).toBeDisabled()
  })

  it('shows progress while PROVISIONING, with no actions', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'PROVISIONING', step: 'namespace_created' }),
      configured: true,
      scopedRunnerConfigured: true,
    })
    renderSection()
    expect(await screen.findByText(/step: namespace_created/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TenantTemporalNamespaceSection — routing (3b.2)', () => {
  const state = (overrides: Partial<TemporalNamespace>, scopedRunnerConfigured = true) => ({
    data: ns(overrides),
    configured: true,
    scopedRunnerConfigured,
  })

  it('READY says Automations still run in the shared namespace, and cuts over after a confirm', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue(state({}))
    vi.mocked(cutoverTemporalNamespace).mockResolvedValue({ data: ns({ status: 'DRAINING' }) })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-routing')).toHaveTextContent(
      'shared platform namespace',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cut over' }))
    expect(cutoverTemporalNamespace).not.toHaveBeenCalled()
    expect(screen.getByTestId('temporal-namespace-confirm-cutover')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, cut over' }))
    await waitFor(() => expect(cutoverTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('disables Cut over, and says why, when the scoped runner is not deployed', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue(state({}, false))
    renderSection()
    expect(await screen.findByRole('button', { name: 'Cut over' })).toBeDisabled()
    expect(screen.getByTestId('temporal-namespace-no-scoped-runner')).toBeInTheDocument()
  })

  it('DRAINING shows what it is waiting for, offers Cancel cutover, and no Deprovision', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue(
      state({ status: 'DRAINING', openExecutions: 2 }),
    )
    vi.mocked(rollbackTemporalNamespace).mockResolvedValue({ data: ns() })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-status')).toHaveTextContent('Cutting over')
    expect(screen.getByTestId('temporal-namespace-routing')).toHaveTextContent(
      'Waiting for 2 open runs to finish',
    )
    expect(screen.queryByRole('button', { name: 'Deprovision' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel cutover' }))
    await waitFor(() => expect(rollbackTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('ACTIVE runs here, still rotates, and rolls back after a confirm; no Deprovision', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue(state({ status: 'ACTIVE' }))
    vi.mocked(rollbackTemporalNamespace).mockResolvedValue({ data: ns({ status: 'REVERTING' }) })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-routing')).toHaveTextContent(
      'Automations run in this namespace',
    )
    expect(screen.getByRole('button', { name: 'Rotate key' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Deprovision' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }))
    expect(rollbackTemporalNamespace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, roll back' }))
    await waitFor(() => expect(rollbackTemporalNamespace).toHaveBeenCalledWith(TENANT))
  })

  it('REVERTING shows the drain and offers neither cutover nor rollback', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue(
      state({ status: 'REVERTING', openExecutions: 1 }),
    )
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-routing')).toHaveTextContent(
      'Waiting for 1 open run to finish',
    )
    expect(screen.queryByRole('button', { name: 'Cut over' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Roll back' })).toBeNull()
  })
})
