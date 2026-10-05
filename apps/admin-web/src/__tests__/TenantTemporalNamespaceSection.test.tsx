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
}))
vi.mock('@/auth/cognito', () => ({ getAccessToken: () => 'tok-123' }))
vi.mock('@/config', () => ({ getConfig: () => ({ apiUrl: 'https://api.test' }) }))

import {
  getTemporalNamespace,
  provisionTemporalNamespace,
  rotateTemporalNamespaceKey,
  deprovisionTemporalNamespace,
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
    vi.mocked(getTemporalNamespace).mockResolvedValue({ data: null, configured: false })
    renderSection()
    expect(await screen.findByTestId('temporal-namespace-not-configured')).toHaveTextContent(
      'Temporal namespace provisioning is not configured for this environment',
    )
    expect(screen.getByRole('button', { name: 'Provision namespace' })).toBeDisabled()
  })

  it('provisions a tenant with no namespace', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({ data: null, configured: true })
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
    vi.mocked(getTemporalNamespace).mockResolvedValue({ data: ns(), configured: true })
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
    vi.mocked(getTemporalNamespace).mockResolvedValue({ data: ns(), configured: true })
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
    })
    renderSection()
    expect(await screen.findByRole('button', { name: 'Retry provisioning' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deprovision' })).toBeDisabled()
  })

  it('shows progress while PROVISIONING, with no actions', async () => {
    vi.mocked(getTemporalNamespace).mockResolvedValue({
      data: ns({ status: 'PROVISIONING', step: 'namespace_created' }),
      configured: true,
    })
    renderSection()
    expect(await screen.findByText(/step: namespace_created/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
