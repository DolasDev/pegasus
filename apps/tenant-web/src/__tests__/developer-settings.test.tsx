// ---------------------------------------------------------------------------
// DeveloperSettingsPage tests — M2M API client management + MSSQL settings
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
//   - MSSQL settings section
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

// Mock the MSSQL settings query module
const mockUseUpdateMssqlSettings = vi.fn()

vi.mock('@/api/queries/settings', () => ({
  mssqlSettingsQueryOptions: {
    queryKey: ['settings', 'mssql'],
    queryFn: vi.fn(),
  },
  useUpdateMssqlSettings: () => mockUseUpdateMssqlSettings(),
}))

const apiClientsQueryKey = ['api-clients', 'list']
const mssqlSettingsQueryKey = ['settings', 'mssql']

let apiClientsReturn: Record<string, unknown> = { data: [], isLoading: false, isError: false }
let mssqlSettingsReturn: Record<string, unknown> = {
  data: { mssqlConnectionString: null },
  isLoading: false,
  isError: false,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly string[] }) => {
      if (
        options.queryKey[0] === apiClientsQueryKey[0] &&
        options.queryKey[1] === apiClientsQueryKey[1]
      ) {
        return apiClientsReturn
      }
      if (
        options.queryKey[0] === mssqlSettingsQueryKey[0] &&
        options.queryKey[1] === mssqlSettingsQueryKey[1]
      ) {
        return mssqlSettingsReturn
      }
      return { data: undefined, isLoading: false, isError: false }
    },
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
    mockUseUpdateMssqlSettings.mockReturnValue(makeMutationResult())

    // Default returns
    apiClientsReturn = { data: [], isLoading: false, isError: false }
    mssqlSettingsReturn = {
      data: { mssqlConnectionString: null },
      isLoading: false,
      isError: false,
    }
  })

  it('shows loading state', () => {
    apiClientsReturn = { data: undefined, isLoading: true, isError: false }
    renderPage()
    expect(screen.getByText(/loading api clients/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    apiClientsReturn = { data: undefined, isLoading: false, isError: true }
    renderPage()
    expect(screen.getByText(/failed to load api clients/i)).toBeInTheDocument()
  })

  it('shows empty state when no API clients exist', () => {
    apiClientsReturn = { data: [], isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText('No API Clients')).toBeInTheDocument()
  })

  it('renders a list of API clients with name and key prefix', () => {
    const clients = [
      makeClient({ id: 'c-1', name: 'Zapier Integration', keyPrefix: 'pk_live_abc' }),
      makeClient({ id: 'c-2', name: 'Slack Bot', keyPrefix: 'pk_live_xyz' }),
    ]
    apiClientsReturn = { data: clients, isLoading: false, isError: false }
    renderPage()

    expect(screen.getByText('Zapier Integration')).toBeInTheDocument()
    expect(screen.getByText('pk_live_abc****')).toBeInTheDocument()
    expect(screen.getByText('Slack Bot')).toBeInTheDocument()
    expect(screen.getByText('pk_live_xyz****')).toBeInTheDocument()
  })

  it('shows Edit, Rotate, and Revoke buttons for active clients', () => {
    apiClientsReturn = {
      data: [makeClient()],
      isLoading: false,
      isError: false,
    }
    renderPage()

    expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Rotate')).toBeInTheDocument()
    expect(screen.getByText('Revoke')).toBeInTheDocument()
  })

  it('shows Revoked badge and hides action buttons for revoked clients', () => {
    const revoked = makeClient({ revokedAt: '2026-02-01T00:00:00Z' })
    apiClientsReturn = { data: [revoked], isLoading: false, isError: false }
    renderPage()

    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByText('Rotate')).not.toBeInTheDocument()
    // The "Revoke" button should also be hidden for already-revoked clients
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
  })

  it('opens the create form when "Create API Client" is clicked', () => {
    apiClientsReturn = { data: [], isLoading: false, isError: false }
    renderPage()

    fireEvent.click(screen.getByText('Create API Client'))
    expect(screen.getByText('Create API Client', { selector: 'h3,div' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Scopes')).toBeInTheDocument()
  })

  it('opens the edit form when "Edit" is clicked', () => {
    apiClientsReturn = {
      data: [makeClient({ name: 'My Key' })],
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getAllByText('Edit')[0]!)
    expect(screen.getByText('Edit API Client')).toBeInTheDocument()
    // The name input should contain the existing value
    expect(screen.getByDisplayValue('My Key')).toBeInTheDocument()
  })

  it('shows revoke confirmation when "Revoke" is clicked', () => {
    apiClientsReturn = {
      data: [makeClient({ name: 'Test Key' })],
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByText('Revoke'))
    expect(screen.getByText('Revoke API Client?')).toBeInTheDocument()
    expect(screen.getByText('Revoke Client')).toBeInTheDocument()
  })

  it('shows rotate confirmation when "Rotate" is clicked', () => {
    apiClientsReturn = {
      data: [makeClient({ name: 'Test Key' })],
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByText('Rotate'))
    expect(screen.getByText('Rotate API Key?')).toBeInTheDocument()
    expect(screen.getByText('Rotate Key')).toBeInTheDocument()
  })

  it('dismisses revoke confirmation when Cancel is clicked', () => {
    apiClientsReturn = {
      data: [makeClient()],
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByText('Revoke'))
    expect(screen.getByText('Revoke API Client?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Revoke API Client?')).not.toBeInTheDocument()
  })

  it('dismisses rotate confirmation when Cancel is clicked', () => {
    apiClientsReturn = {
      data: [makeClient()],
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByText('Rotate'))
    expect(screen.getByText('Rotate API Key?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Rotate API Key?')).not.toBeInTheDocument()
  })

  it('displays scopes in the client row', () => {
    apiClientsReturn = {
      data: [makeClient({ scopes: ['read:moves', 'write:moves'] })],
      isLoading: false,
      isError: false,
    }
    renderPage()

    expect(screen.getByText('read:moves, write:moves')).toBeInTheDocument()
  })

  it('renders the page header with correct title', () => {
    apiClientsReturn = { data: [], isLoading: false, isError: false }
    renderPage()
    expect(screen.getAllByText('Developer Settings').length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // MSSQL Settings section
  // -------------------------------------------------------------------------

  describe('MSSQL Settings', () => {
    it('renders the Legacy Database Connection title', () => {
      renderPage()
      expect(screen.getByText('Legacy Database Connection')).toBeInTheDocument()
    })

    it('shows "Not configured" when mssqlConnectionString is null', () => {
      mssqlSettingsReturn = {
        data: { mssqlConnectionString: null },
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByText('Not configured')).toBeInTheDocument()
    })

    it('shows masked connection string when value exists', () => {
      mssqlSettingsReturn = {
        data: {
          mssqlConnectionString:
            'Server=myserver.database.windows.net;Database=mydb;User Id=sa;Password=secret123',
        },
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByText('Server=myserver.data********')).toBeInTheDocument()
    })

    it('shows Edit button that toggles to input mode', () => {
      mssqlSettingsReturn = {
        data: { mssqlConnectionString: null },
        isLoading: false,
        isError: false,
      }
      renderPage()

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[editButtons.length - 1]!)

      expect(screen.getByPlaceholderText(/Server=myserver/)).toBeInTheDocument()
    })

    it('shows Save and Cancel buttons in edit mode', () => {
      mssqlSettingsReturn = {
        data: { mssqlConnectionString: null },
        isLoading: false,
        isError: false,
      }
      renderPage()

      const editButtons = screen.getAllByText('Edit')
      fireEvent.click(editButtons[editButtons.length - 1]!)

      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('shows loading state for MSSQL settings', () => {
      mssqlSettingsReturn = {
        data: undefined,
        isLoading: true,
        isError: false,
      }
      renderPage()
      expect(screen.getByText('Loading settings...')).toBeInTheDocument()
    })

    it('shows Clear button when connection string exists', () => {
      mssqlSettingsReturn = {
        data: { mssqlConnectionString: 'Server=myserver;Database=mydb;' },
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByText('Clear')).toBeInTheDocument()
    })
  })
})
