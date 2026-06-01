// ---------------------------------------------------------------------------
// DriverPlanningPage smoke tests
//
// Boundary: route-level page that renders the Availability table by issuing
// a TanStack Query call (driverPlanningQueryOptions).
//
// Strategy: mock @tanstack/react-query's useQuery so we can control the data
// returned per query key (matching the developer-settings.test.tsx pattern).
// We render inside a real QueryClientProvider so non-mocked hooks still work.
// @tanstack/react-router's Link is mocked to a plain anchor so the page renders
// outside a RouterProvider.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverPlanningPage } from './driver-planning.index'
import type { Delivery, DriverPlanningRow } from '@/api/queries/driver-planning'

// Shared mutate spy so commit assertions can inspect the payload.
const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }))

// ---------------------------------------------------------------------------
// Mock the mutation hook (it pulls in apiFetch which we don't want firing)
// ---------------------------------------------------------------------------
vi.mock('@/api/queries/driver-planning', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/queries/driver-planning')
  return {
    ...actual,
    useUpdateConfirmedAvailability: () => ({ mutate: mutateMock, isPending: false }),
  }
})

// ---------------------------------------------------------------------------
// Mock @tanstack/react-router Link → plain anchor with resolved href
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: Record<string, unknown>) => {
    const href =
      typeof to === 'string' && params
        ? to.replace(/\$(\w+)/g, (_m: string, k: string) =>
            String((params as Record<string, unknown>)[k]),
          )
        : (to as string)
    return (
      <a href={href} {...(rest as Record<string, unknown>)}>
        {children as React.ReactNode}
      </a>
    )
  },
}))

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

  it('renders the renamed headers (Ready Date/Location) and a row per driver', () => {
    driverPlanningReturn = {
      data: [
        makeDriver({ driverId: 1, driverName: 'Alice Driver' }),
        makeDriver({ driverId: 2, driverName: 'Bob Driver' }),
      ],
      isLoading: false,
      isError: false,
    }
    renderPage()

    // Headers — Confirmed → Ready, Current Trip moved to the end.
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Ready Date')).toBeInTheDocument()
    expect(screen.getByText('Ready Location')).toBeInTheDocument()
    expect(screen.getByText('Current Trip')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed Date')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmed Location')).not.toBeInTheDocument()

    // Rows
    expect(screen.getByText('Alice Driver')).toBeInTheDocument()
    expect(screen.getByText('Bob Driver')).toBeInTheDocument()
  })

  it('renders the current trip as a link to the trip screen, without the trip number', () => {
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
    const link = screen.getByTestId('current-trip-link')
    expect(link).toHaveTextContent('Houston Run')
    expect(link).not.toHaveTextContent('#42')
    expect(link.getAttribute('href')).toBe('/driver-planning/trips/42')
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

  describe('click-to-edit fields', () => {
    it('opens an inline date input when the Ready Date cell is clicked', () => {
      driverPlanningReturn = { data: [makeDriver()], isLoading: false, isError: false }
      renderPage()
      expect(screen.queryByTestId('confirmed-date-input')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('ready-date-cell'))
      expect(screen.getByTestId('confirmed-date-input')).toBeInTheDocument()
    })

    it('commits the edited Notes via the mutation on blur', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 5 })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('notes-cell'))
      const input = screen.getByTestId('confirmed-notes-input')
      fireEvent.change(input, { target: { value: 'back Tuesday' } })
      fireEvent.blur(input)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 5, notes: 'back Tuesday' }),
        expect.anything(),
      )
    })

    it('reverts the field on Escape without calling the mutation', () => {
      driverPlanningReturn = { data: [makeDriver()], isLoading: false, isError: false }
      renderPage()
      fireEvent.click(screen.getByTestId('notes-cell'))
      const input = screen.getByTestId('confirmed-notes-input')
      fireEvent.change(input, { target: { value: 'oops' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(mutateMock).not.toHaveBeenCalled()
      expect(screen.queryByTestId('confirmed-notes-input')).not.toBeInTheDocument()
    })
  })

  describe('ready date best-guess tiers', () => {
    it('shows the confirmed ready date bold with a calendar-check icon', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableDate: '2026-07-01' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('confirmed')
      expect(cell.className).toMatch(/font-semibold/)
      expect(cell.querySelector('.fa-calendar-check')).toBeTruthy()
    })

    it('greys an estimated guess (no italics)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({ deliveries: [delivery({ actualDate: null, estimatedDate: '2026-06-09' })] }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('estimated')
      expect(cell.className).toMatch(/text-muted-foreground/)
      expect(cell.className).not.toMatch(/italic/)
    })

    it('greys + italicises a spread-only guess', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({ actualDate: null, estimatedDate: null, plannedEnd: '2026-06-10' }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('spread')
      expect(cell.className).toMatch(/italic/)
    })

    it('leaves an actual guess unformatted', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-15' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('actual')
      expect(cell.className).not.toMatch(/text-muted-foreground/)
      expect(cell.className).not.toMatch(/italic/)
    })
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

    it('always renders all three date slots (no collapsing) with the effective bolded', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-03',
                estimatedDate: '2026-06-01', // matches the start — must NOT collapse
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
      expect(line.textContent).toContain('06/01')
      expect(line.textContent).toContain('06/03')
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/01')
      expect(eff.className).toMatch(/font-semibold/)
    })

    it('renders three dates with the middle bolded + colored when estimated is inside the spread', () => {
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

    it('shows phone + SMS quick-actions in place of the middle date when no actual/estimated', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [delivery({ actualDate: null, estimatedDate: null })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.queryByTestId('delivery-effective')).not.toBeInTheDocument()
      expect(screen.getByTestId('delivery-call').getAttribute('href')).toBe('tel:+12345678910')
      expect(screen.getByTestId('delivery-sms').getAttribute('href')).toBe('sms:+12345678910')
    })

    it('renders the truck icon for an actual_date delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-02' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-truck-moving')
    })

    it('renders the flag icon for a confirmed-but-not-actualised delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ isConfirmed: true })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-flag-checkered')
    })

    it('renders the check icon for a committed-only delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ isCommitted: true })] })],
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

    it('renders the state code (bold) and title-cased city in the row', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ city: 'EL PASO', state: 'TX' })] })],
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
