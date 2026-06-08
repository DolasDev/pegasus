// ---------------------------------------------------------------------------
// RingCentralIntegrationPage tests
//
// Tests cover:
//   - Loading state rendering
//   - Error state rendering
//   - Empty / disconnected state (number input + Connect button)
//   - Connect: invalid/disabled state with no number, calls startRingCentralConnect
//   - Connected state (renders a connection + Disconnect button)
//   - Clicking Disconnect reveals the confirm card
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RingCentralIntegrationPage } from '../routes/settings.integrations.ringcentral'
import type { RcConnection } from '../api/ringcentral'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

// Mock the React Query hooks from our ringcentral query module
const mockUseDisconnectRingCentral = vi.fn()

vi.mock('@/api/queries/ringcentral', () => ({
  ringCentralConnectionsQueryOptions: {
    queryKey: ['integrations', 'ringcentral', 'connections'],
    queryFn: vi.fn(),
  },
  useDisconnectRingCentral: () => mockUseDisconnectRingCentral(),
}))

// Mock the imperative connect call.
const mockStartConnect = vi.fn()
vi.mock('@/api/ringcentral', () => ({
  startRingCentralConnect: (...args: unknown[]) => mockStartConnect(...args),
}))

const connectionsQueryKey = ['integrations', 'ringcentral', 'connections']

let connectionsReturn: Record<string, unknown> = {
  data: { connections: [] },
  isLoading: false,
  isError: false,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly string[] }) => {
      if (
        options.queryKey[0] === connectionsQueryKey[0] &&
        options.queryKey[1] === connectionsQueryKey[1]
      ) {
        return connectionsReturn
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
    mutateAsync: vi.fn().mockResolvedValue({ disconnected: true }),
    ...overrides,
  }
}

function makeConnection(overrides?: Partial<RcConnection>): RcConnection {
  return {
    id: 'conn-1',
    ownerNumber: '+14155550123',
    rcAccountId: 'acc-1',
    rcExtensionId: 'ext-1',
    tokenStatus: 'ACTIVE',
    health: 'HEALTHY',
    lastRefreshedAt: '2026-06-01T00:00:00Z',
    scopes: ['ReadCallLog', 'SMS'],
    createdAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RingCentralIntegrationPage />
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RingCentralIntegrationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDisconnectRingCentral.mockReturnValue(makeMutationResult())
    mockStartConnect.mockResolvedValue({ url: 'https://rc.example/authorize' })
    connectionsReturn = {
      data: { connections: [] },
      isLoading: false,
      isError: false,
    }
  })

  it('shows loading state', () => {
    connectionsReturn = { data: undefined, isLoading: true, isError: false }
    renderPage()
    expect(screen.getByText(/loading ringcentral connections/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    connectionsReturn = { data: undefined, isLoading: false, isError: true }
    renderPage()
    expect(screen.getByText(/failed to load ringcentral connections/i)).toBeInTheDocument()
  })

  it('shows the connect form (number input + button) when there are no connections', () => {
    connectionsReturn = { data: { connections: [] }, isLoading: false, isError: false }
    renderPage()

    expect(screen.getByLabelText(/owner phone number/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect ringcentral/i })).toBeInTheDocument()
  })

  it('disables Connect until a number is entered, then calls startRingCentralConnect', async () => {
    connectionsReturn = { data: { connections: [] }, isLoading: false, isError: false }
    renderPage()

    const button = screen.getByRole('button', { name: /connect ringcentral/i })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/owner phone number/i), {
      target: { value: '+14155550123' },
    })
    expect(button).not.toBeDisabled()

    fireEvent.click(button)
    await waitFor(() => {
      expect(mockStartConnect).toHaveBeenCalledWith('+14155550123')
    })
  })

  it('renders a connection card with owner number, health badge and scopes', () => {
    connectionsReturn = {
      data: { connections: [makeConnection()] },
      isLoading: false,
      isError: false,
    }
    renderPage()

    expect(screen.getByText('+14155550123')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('ReadCallLog')).toBeInTheDocument()
    expect(screen.getByText('SMS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument()
  })

  it('shows an Unhealthy badge when the token is expired', () => {
    connectionsReturn = {
      data: { connections: [makeConnection({ tokenStatus: 'EXPIRED' })] },
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByText('Unhealthy')).toBeInTheDocument()
  })

  it('reveals the disconnect confirm card when Disconnect is clicked', () => {
    connectionsReturn = {
      data: { connections: [makeConnection()] },
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }))
    expect(screen.getByText('Disconnect RingCentral?')).toBeInTheDocument()
  })

  it('calls the disconnect mutation when confirmed', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ disconnected: true })
    mockUseDisconnectRingCentral.mockReturnValue(makeMutationResult({ mutateAsync }))
    connectionsReturn = {
      data: { connections: [makeConnection()] },
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }))
    expect(screen.getByText('Disconnect RingCentral?')).toBeInTheDocument()

    // The confirm card's destructive button is labelled "Disconnect".
    const confirmButton = screen.getAllByRole('button', { name: /^disconnect$/i }).pop()!
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith('conn-1')
    })
  })

  it('cancels the disconnect confirm card', () => {
    connectionsReturn = {
      data: { connections: [makeConnection()] },
      isLoading: false,
      isError: false,
    }
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }))
    expect(screen.getByText('Disconnect RingCentral?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Disconnect RingCentral?')).not.toBeInTheDocument()
  })
})
