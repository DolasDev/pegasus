// ---------------------------------------------------------------------------
// DriverPlanningPage smoke tests
//
// Boundary: route-level page that renders the Availability table by issuing
// a TanStack Query call (driverPlanningQueryOptions).
//
// Strategy: mock @tanstack/react-query's useQuery so we can control the data
// returned per query key (matching the developer-settings.test.tsx pattern).
// We render inside a real QueryClientProvider so non-mocked hooks still work.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverPlanningPage } from './driver-planning.index'
import type { DriverPlanningRow } from '@/api/queries/driver-planning'

// ---------------------------------------------------------------------------
// Mock the mutation hook (it pulls in apiFetch which we don't want firing)
// ---------------------------------------------------------------------------
vi.mock('@/api/queries/driver-planning', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/queries/driver-planning')
  return {
    ...actual,
    useUpdateConfirmedAvailability: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

// ---------------------------------------------------------------------------
// Mock useQuery to dispatch by query key
// ---------------------------------------------------------------------------
let driverPlanningReturn: Record<string, unknown> = {
  data: [],
  isLoading: false,
  isError: false,
}

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const head = options.queryKey?.[0]
      if (head === 'driver-planning') return driverPlanningReturn
      return { data: undefined, isLoading: false, isError: false }
    },
  }
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DriverPlanningPage />
    </QueryClientProvider>,
  )
}

function makeDriver(overrides?: Partial<DriverPlanningRow>): DriverPlanningRow {
  return {
    driverId: 1,
    driverName: 'Alice Driver',
    agentCode: 'A1',
    currentTripId: null,
    currentTripTitle: null,
    estimatedAvailableDate: '2026-06-01',
    estimatedAvailableLocation: 'Dallas, TX',
    confirmedAvailableDate: null,
    confirmedAvailableLocation: null,
    confirmedNotes: null,
    ...overrides,
  }
}

describe('DriverPlanningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    driverPlanningReturn = { data: [], isLoading: false, isError: false }
  })

  it('shows Loading text while drivers are loading', () => {
    driverPlanningReturn = { data: undefined, isLoading: true, isError: false }
    renderPage()
    expect(screen.getByText(/loading\.\.\./i)).toBeInTheDocument()
  })

  it('renders the empty state when there are no drivers', () => {
    driverPlanningReturn = { data: [], isLoading: false, isError: false }
    renderPage()
    expect(screen.getByText(/no drivers found/i)).toBeInTheDocument()
  })

  it('renders the table headers and a row per driver', () => {
    driverPlanningReturn = {
      data: [
        makeDriver({ driverId: 1, driverName: 'Alice Driver' }),
        makeDriver({ driverId: 2, driverName: 'Bob Driver' }),
      ],
      isLoading: false,
      isError: false,
    }
    renderPage()

    // Headers
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Current Trip')).toBeInTheDocument()
    expect(screen.getByText('Confirmed Date')).toBeInTheDocument()

    // Rows
    expect(screen.getByText('Alice Driver')).toBeInTheDocument()
    expect(screen.getByText('Bob Driver')).toBeInTheDocument()
  })

  it('shows current trip badge when driver has an active trip', () => {
    driverPlanningReturn = {
      data: [
        makeDriver({
          driverId: 7,
          driverName: 'Gary',
          currentTripId: 42,
          currentTripTitle: 'Houston Run',
        }),
      ],
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByText(/#42 - Houston Run/)).toBeInTheDocument()
  })

  it('renders the filter input', () => {
    driverPlanningReturn = {
      data: [makeDriver()],
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByPlaceholderText(/filter by driver name/i)).toBeInTheDocument()
  })
})
