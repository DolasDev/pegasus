import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'

import { renderWithStore } from '../../__test-utils__/render-with-store'

// Mock the API module so all bootstrap thunks resolve deterministically without
// touching the network. The factory only creates the bare vi.fn shells; each
// test (or beforeEach) installs the actual implementation so we never leak
// state between tests.
vi.mock('../../utils/api', () => {
  const API = {
    fetchUser: vi.fn(),
    fetchVersion: vi.fn(),
    fetchDrivers: vi.fn(),
    fetchTripStatuses: vi.fn(),
    fetchStates: vi.fn(),
    fetchZones: vi.fn(),
    fetchPlanners: vi.fn(),
    fetchDispatchers: vi.fn(),
    fetchFilterOptions: vi.fn(),
    fetchShipmentDefaultFilterForUser: vi.fn(),
  }
  return { API }
})

import { AppGuard } from './index'
import { API } from '../../utils/api'

const DEFAULT_USER = { code: 'USER1', name: 'Test User' }
const DEFAULT_VERSION = {
  clientVersion: '1.0.0',
  release_channel: 'stable',
  supportedVersions: [{ database_version: 'db-1', supported_client_version: '1.0.0' }],
}

function installHappyPathDefaults() {
  ;(API.fetchUser as any).mockResolvedValue(DEFAULT_USER)
  ;(API.fetchVersion as any).mockResolvedValue(DEFAULT_VERSION)
  ;(API.fetchDrivers as any).mockResolvedValue([])
  ;(API.fetchTripStatuses as any).mockResolvedValue([])
  ;(API.fetchStates as any).mockResolvedValue([])
  ;(API.fetchZones as any).mockResolvedValue([])
  ;(API.fetchPlanners as any).mockResolvedValue([])
  ;(API.fetchDispatchers as any).mockResolvedValue([])
  ;(API.fetchFilterOptions as any).mockResolvedValue({})
  ;(API.fetchShipmentDefaultFilterForUser as any).mockResolvedValue(null)
}

describe('AppGuard', () => {
  beforeEach(() => {
    // Wipe out call history AND any per-test implementation overrides so each
    // test starts from a clean, fully-stubbed happy-path baseline.
    Object.values(API).forEach((fn: any) => fn.mockReset?.())
    installHappyPathDefaults()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches all bootstrap thunks on mount', async () => {
    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(API.fetchUser).toHaveBeenCalledTimes(1)
      expect(API.fetchVersion).toHaveBeenCalledTimes(1)
      expect(API.fetchDrivers).toHaveBeenCalledTimes(1)
      expect(API.fetchTripStatuses).toHaveBeenCalledTimes(1)
      expect(API.fetchStates).toHaveBeenCalledTimes(1)
      expect(API.fetchZones).toHaveBeenCalledTimes(1)
      expect(API.fetchPlanners).toHaveBeenCalledTimes(1)
      expect(API.fetchDispatchers).toHaveBeenCalledTimes(1)
      expect(API.fetchFilterOptions).toHaveBeenCalledTimes(1)
    })
  })

  it('calls loadDefaultFilter once a user with a code arrives in the store', async () => {
    renderWithStore(
      <AppGuard>
        <div>child</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(API.fetchShipmentDefaultFilterForUser).toHaveBeenCalled()
    })
  })

  it('renders the loading indicator while user/version are still loading and no user is set', () => {
    // Force fetchUser/fetchVersion to never resolve so loading state persists.
    ;(API.fetchUser as any).mockImplementation(() => new Promise(() => {}))
    ;(API.fetchVersion as any).mockImplementation(() => new Promise(() => {}))

    renderWithStore(
      <AppGuard>
        <div data-testid="children">hidden</div>
      </AppGuard>,
    )
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('children')).not.toBeInTheDocument()
  })

  it('renders an error screen with the server message when fetchUser rejects', async () => {
    ;(API.fetchUser as any).mockRejectedValue(new Error('User not authorized for longhaul'))

    renderWithStore(
      <AppGuard>
        <div data-testid="children">should not render</div>
      </AppGuard>,
    )
    await waitFor(() => {
      expect(
        screen.getByText('There is a problem with your Driver Planning session'),
      ).toBeInTheDocument()
    })
    expect(screen.getByText(/User not authorized for longhaul/)).toBeInTheDocument()
    expect(screen.getByText(/Server response/)).toBeInTheDocument()
    expect(screen.queryByTestId('children')).not.toBeInTheDocument()
  })

  it('renders the unmapped-cognito-user fallback after fetchUser rejects with no message', async () => {
    // A rejection whose Error has an empty message string still flips loading
    // off and leaves errorMessage falsy, which is the "unmapped" branch.
    ;(API.fetchUser as any).mockRejectedValue(Object.assign(new Error(), { message: '' }))

    renderWithStore(
      <AppGuard>
        <div>child</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Your Cognito user is not mapped to a Long Haul user record.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/Server response/)).not.toBeInTheDocument()
  })

  it('transitions from loading to children when bootstrap completes successfully', async () => {
    renderWithStore(
      <AppGuard>
        <div data-testid="children">eventual content</div>
      </AppGuard>,
    )

    // After the mocked thunks resolve and the user slice is populated, the
    // children should appear.
    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
  })

  it('does not call loadDefaultFilter when fetchUser returns a user without a code', async () => {
    ;(API.fetchUser as any).mockResolvedValue({ name: 'No Code Here' })

    await act(async () => {
      renderWithStore(
        <AppGuard>
          <div>child</div>
        </AppGuard>,
      )
    })

    await waitFor(() => {
      expect(API.fetchUser).toHaveBeenCalled()
    })
    expect(API.fetchShipmentDefaultFilterForUser).not.toHaveBeenCalled()
  })

  it('renders children once the user slice is populated', async () => {
    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(
      screen.queryByText('There is a problem with your Driver Planning session'),
    ).not.toBeInTheDocument()
  })

  it('renders children when the fetched client version is in the supported list', async () => {
    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('There is a problem with your Driver Planning session'),
    ).not.toBeInTheDocument()
  })

  it('renders children even when the fetched client version is not in the supported list', async () => {
    // The legacy Electron client-version gate doesn't apply to this web port —
    // it's always the latest deployed build — so a version mismatch (or a
    // /version response that doesn't match the legacy shape) must not wall the
    // module. Only the user lookup gates rendering.
    ;(API.fetchVersion as any).mockResolvedValue({
      clientVersion: '0.9.0',
      release_channel: 'stable',
      supportedVersions: [
        { database_version: 'db-2', supported_client_version: '2.0.0' },
        { database_version: 'db-2', supported_client_version: '2.1.0' },
      ],
    })

    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('There is a problem with your Driver Planning session'),
    ).not.toBeInTheDocument()
  })

  it('renders children even when /version errors / returns an unexpected shape', async () => {
    ;(API.fetchVersion as any).mockResolvedValue({ max: '2.1.1' }) // not the legacy shape

    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
  })

  it('renders children once the user resolves, without waiting on the version fetch', async () => {
    ;(API.fetchVersion as any).mockImplementation(() => new Promise(() => {}))

    renderWithStore(
      <AppGuard>
        <div data-testid="children">eventual content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
  })

  it('still renders children but surfaces a snackbar when a reference-data fetch rejects', async () => {
    // Reference-data thunks re-throw on error; AppGuard collects every failure
    // and lists the failed lookups by label in a single snackbar. Children
    // should still render because fetchUser + fetchVersion succeed.
    ;(API.fetchDrivers as any).mockRejectedValue(new Error('drivers blew up'))

    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('children')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText(/Failed to load reference data: drivers/)).toBeInTheDocument()
    })
  })

  it('lists every failed reference-data lookup in one snackbar', async () => {
    // When several lookups fail (e.g. the executor is being throttled), the
    // snackbar must name all of them — not just drivers — so the user/operator
    // sees the true blast radius.
    ;(API.fetchDrivers as any).mockRejectedValue(new Error('boom'))
    ;(API.fetchZones as any).mockRejectedValue(new Error('boom'))
    ;(API.fetchStates as any).mockRejectedValue(new Error('boom'))

    renderWithStore(
      <AppGuard>
        <div data-testid="children">child content</div>
      </AppGuard>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load reference data: drivers, states, zones'),
      ).toBeInTheDocument()
    })
  })
})
