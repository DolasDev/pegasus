// ---------------------------------------------------------------------------
// DeveloperSettingsPage tests — M2M API client management
//
// Tests cover:
//   - Loading state rendering
//   - Error state rendering
//   - Empty state (no API clients)
//   - Rendering a list of API clients
//   - "Create API Client" button opens the form
//   - Revoked clients show "Revoked" badge and hide action buttons
//   - Clicking "Revoke" shows the revoke confirmation dialog
//   - Clicking "Rotate" shows the rotate confirmation dialog
//   - Clicking "Edit" shows the edit form
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeveloperSettingsPage } from '../routes/settings.developer'
import type { ApiClient } from '../api/api-clients'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

// Mock the React Query hooks from our api-clients query module
const mockUseCreateApiClient = vi.fn()
const mockUseUpdateApiClient = vi.fn()
const mockUseRevokeApiClient = vi.fn()
const mockUseRotateApiClient = vi.fn()

vi.mock('@/api/queries/api-clients', () => ({
  apiClientsQueryOptions: {
    queryKey: ['api-clients', 'list'],
    queryFn: vi.fn(),
  },
  useCreateApiClient: () => mockUseCreateApiClient(),
  useUpdateApiClient: () => mockUseUpdateApiClient(),
  useRevokeApiClient: () => mockUseRevokeApiClient(),
  useRotateApiClient: () => mockUseRotateApiClient(),
}))

// Mock useQuery to control what data the component receives
const mockUseQueryReturn = vi.fn()
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => mockUseQueryReturn(),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMutationResult(overrides?: Record<string, unknown>) {
  return {
    isPending: false,
    mutateAsync: vi.fn(),
    ...overrides,
  }
}

function makeClient(overrides?: Partial<ApiClient>): ApiClient {
  return {
    id: 'c-1',
    tenantId: 't-1',
    name: 'Zapier Integration',
    keyPrefix: 'pk_live_abc',
    scopes: ['*'],
    lastUsedAt: null,
    revokedAt: null,
    createdById: 'u-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DeveloperSettingsPage />
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeveloperSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCreateApiClient.mockReturnValue(makeMutationResult())
    mockUseUpdateApiClient.mockReturnValue(makeMutationResult())
    mockUseRevokeApiClient.mockReturnValue(makeMutationResult())
    mockUseRotateApiClient.mockReturnValue(makeMutationResult())
  })

  it('shows loading state', () => {
    mockUseQueryReturn.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderPage()
    expect(screen.getByText(/loading api clients/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    mockUseQueryReturn.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()
    expect(screen.getByText(/failed to load api clients/i)).toBeInTheDocument()
  })

  it('shows empty state when no API clients exist', () => {
    mockUseQueryReturn.mockReturnValue({ data: [], isLoading: false, isError: false })
    renderPage()
    expect(screen.getByText('No API Clients')).toBeInTheDocument()
  })

  it('renders a list of API clients with name and key prefix', () => {
    const clients = [
      makeClient({ id: 'c-1', name: 'Zapier Integration', keyPrefix: 'pk_live_abc' }),
      makeClient({ id: 'c-2', name: 'Slack Bot', keyPrefix: 'pk_live_xyz' }),
    ]
    mockUseQueryReturn.mockReturnValue({ data: clients, isLoading: false, isError: false })
    renderPage()

    expect(screen.getByText('Zapier Integration')).toBeInTheDocument()
    expect(screen.getByText('pk_live_abc****')).toBeInTheDocument()
    expect(screen.getByText('Slack Bot')).toBeInTheDocument()
    expect(screen.getByText('pk_live_xyz****')).toBeInTheDocument()
  })

  it('shows Edit, Rotate, and Revoke buttons for active clients', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient()],
      isLoading: false,
      isError: false,
    })
    renderPage()

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Rotate')).toBeInTheDocument()
    expect(screen.getByText('Revoke')).toBeInTheDocument()
  })

  it('shows Revoked badge and hides action buttons for revoked clients', () => {
    const revoked = makeClient({ revokedAt: '2026-02-01T00:00:00Z' })
    mockUseQueryReturn.mockReturnValue({ data: [revoked], isLoading: false, isError: false })
    renderPage()

    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Rotate')).not.toBeInTheDocument()
    // The "Revoke" button should also be hidden for already-revoked clients
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
  })

  it('opens the create form when "Create API Client" is clicked', () => {
    mockUseQueryReturn.mockReturnValue({ data: [], isLoading: false, isError: false })
    renderPage()

    fireEvent.click(screen.getByText('Create API Client'))
    expect(screen.getByText('Create API Client', { selector: 'h3,div' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Scopes')).toBeInTheDocument()
  })

  it('opens the edit form when "Edit" is clicked', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient({ name: 'My Key' })],
      isLoading: false,
      isError: false,
    })
    renderPage()

    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('Edit API Client')).toBeInTheDocument()
    // The name input should contain the existing value
    expect(screen.getByDisplayValue('My Key')).toBeInTheDocument()
  })

  it('shows revoke confirmation when "Revoke" is clicked', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient({ name: 'Test Key' })],
      isLoading: false,
      isError: false,
    })
    renderPage()

    fireEvent.click(screen.getByText('Revoke'))
    expect(screen.getByText('Revoke API Client?')).toBeInTheDocument()
    expect(screen.getByText('Revoke Client')).toBeInTheDocument()
  })

  it('shows rotate confirmation when "Rotate" is clicked', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient({ name: 'Test Key' })],
      isLoading: false,
      isError: false,
    })
    renderPage()

    fireEvent.click(screen.getByText('Rotate'))
    expect(screen.getByText('Rotate API Key?')).toBeInTheDocument()
    expect(screen.getByText('Rotate Key')).toBeInTheDocument()
  })

  it('dismisses revoke confirmation when Cancel is clicked', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient()],
      isLoading: false,
      isError: false,
    })
    renderPage()

    fireEvent.click(screen.getByText('Revoke'))
    expect(screen.getByText('Revoke API Client?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Revoke API Client?')).not.toBeInTheDocument()
  })

  it('dismisses rotate confirmation when Cancel is clicked', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient()],
      isLoading: false,
      isError: false,
    })
    renderPage()

    fireEvent.click(screen.getByText('Rotate'))
    expect(screen.getByText('Rotate API Key?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Rotate API Key?')).not.toBeInTheDocument()
  })

  it('displays scopes in the client row', () => {
    mockUseQueryReturn.mockReturnValue({
      data: [makeClient({ scopes: ['read:moves', 'write:moves'] })],
      isLoading: false,
      isError: false,
    })
    renderPage()

    expect(screen.getByText('read:moves, write:moves')).toBeInTheDocument()
  })

  it('renders the page header with correct title', () => {
    mockUseQueryReturn.mockReturnValue({ data: [], isLoading: false, isError: false })
    renderPage()
    expect(screen.getAllByText('Developer Settings').length).toBeGreaterThanOrEqual(1)
  })
})
