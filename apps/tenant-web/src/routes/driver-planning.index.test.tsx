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
import type { Delivery, DriverPlanningRow } from '@/api/queries/driver-planning'

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
    deliveries: [],
    ...overrides,
  }
}

function delivery(overrides?: Partial<Delivery>): Delivery {
  return {
    activityId: 1,
    plannedStart: '2026-06-01',
    plannedEnd: '2026-06-03',
    estimatedDate: '2026-06-02',
    actualDate: null,
    isCommitted: false,
    isConfirmed: false,
    city: 'DALLAS',
    state: 'TX',
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

  describe('deliveries column', () => {
    it('renders a "-" placeholder when the driver has no deliveries', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('driver-deliveries')
      expect(cell).toHaveTextContent('-')
      expect(screen.queryByTestId('delivery-line')).not.toBeInTheDocument()
    })

    it('renders one row per delivery, preserving the server-side sort order', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({ activityId: 1, city: 'DALLAS', state: 'TX' }),
              delivery({ activityId: 2, city: 'AUSTIN', state: 'TX' }),
              delivery({ activityId: 3, city: 'EL PASO', state: 'TX' }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const lines = screen.getAllByTestId('delivery-line')
      expect(lines).toHaveLength(3)
      expect(lines[0]!.getAttribute('data-activity-id')).toBe('1')
      expect(lines[1]!.getAttribute('data-activity-id')).toBe('2')
      expect(lines[2]!.getAttribute('data-activity-id')).toBe('3')
    })

    it('collapses the spread start when estimated date matches it (two dates shown)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-03',
                estimatedDate: '2026-06-01',
                isCommitted: true,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('delivery-line')
      // Spread start is collapsed into the effective date → MM/DD appears once.
      expect(line.textContent).toContain('06/01')
      expect(line.textContent).toContain('06/03')
      // The effective date carries bold + color styling.
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/01')
      expect(eff.className).toMatch(/font-semibold/)
    })

    it('renders three dates with the middle bolded when estimated falls strictly inside the spread', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-05',
                estimatedDate: '2026-06-03',
                isConfirmed: true,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('delivery-line')
      expect(line.textContent).toContain('06/01')
      expect(line.textContent).toContain('06/05')
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/03')
      expect(eff.className).toMatch(/font-semibold/)
      expect(eff.className).toMatch(/text-emerald-/)
    })

    it('renders the truck icon for an actual_date delivery', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-truck-moving')
    })

    it('renders the flag icon for a confirmed-but-not-actualised delivery', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ isConfirmed: true })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-flag-checkered')
    })

    it('renders the check icon for a committed-only delivery', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ isCommitted: true })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-check')
    })

    it('renders no icon when there is no confidence signal', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ isCommitted: false, isConfirmed: false, actualDate: null })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.queryByTestId('delivery-icon')).not.toBeInTheDocument()
    })

    it('renders the state code (bold) and title-cased city beside the date segment', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ city: 'EL PASO', state: 'TX' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('delivery-line')
      expect(line.textContent).toContain('TX')
      expect(line.textContent).toContain('El Paso')
    })
  })
})
