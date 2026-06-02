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
// outside a RouterProvider. Redux Provider wraps everything because the page
// reads `state.common.stateList` / `state.common.zoneList` for the zone filter.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverPlanningPage } from './driver-planning.index'
import type { Delivery, DriverPlanningRow } from '@/api/queries/driver-planning'
import {
  makeTestStore,
  type PartialTestRootState,
} from '@/features/driver-planning/__test-utils__/render-with-store'

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

function renderPage(preloadedState: PartialTestRootState = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const store = makeTestStore(preloadedState)
  return render(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <DriverPlanningPage />
      </QueryClientProvider>
    </Provider>,
  )
}

function makeDriver(overrides?: Partial<DriverPlanningRow>): DriverPlanningRow {
  return {
    driverId: 1,
    driverName: 'Driver, Alice',
    agentCode: 'A1',
    currentTripId: null,
    currentTripTitle: null,
    estimatedAvailableDate: '2026-06-01',
    estimatedAvailableLocation: 'Dallas, TX',
    confirmedAvailableDate: null,
    confirmedAvailableLocation: null,
    confirmedNotes: null,
    canada: false,
    california: false,
    rating: null,
    equipment: null,
    homeCity: null,
    homeState: null,
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
    // Pin the random variant pick to V-A (index 0). The variants A/C retain the
    // original move-centric columns these suites assert on; V-B has diverged into
    // a roster (covered by its own describe block below). Math.floor(0 * 3) = 0.
    vi.spyOn(Math, 'random').mockReturnValue(0)
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
        makeDriver({ driverId: 1, driverName: 'Driver, Alice' }),
        makeDriver({ driverId: 2, driverName: 'Driver, Bob' }),
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

    // Rows — names render as "Last, F.".
    expect(screen.getByText('Driver, A.')).toBeInTheDocument()
    expect(screen.getByText('Driver, B.')).toBeInTheDocument()
  })

  it('formats the driver name as "Last, F." and renders it bold', () => {
    driverPlanningReturn = {
      data: [makeDriver({ driverName: 'Smith, John' })],
      isLoading: false,
      isError: false,
    }
    renderPage()
    const cell = screen.getByTestId('driver-name')
    expect(cell).toHaveTextContent('Smith, J.')
    expect(cell.className).toMatch(/font-bold/)
  })

  describe('ready location state bolding', () => {
    it('bolds only the state token in the best-guess (no confirmed location) branch', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableLocation: null,
            deliveries: [delivery({ city: 'EL PASO', state: 'TX', actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-location-cell')
      // Outer span is no longer font-semibold; only the inner <b> wrapping the
      // state code carries weight.
      expect(cell.className).not.toMatch(/font-semibold/)
      const bolded = cell.querySelectorAll('b')
      expect(bolded).toHaveLength(1)
      expect(bolded[0]).toHaveTextContent('TX')
      expect(cell).toHaveTextContent('El Paso')
    })

    it('bolds only the leading state token in a "State, City" confirmed location', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableLocation: 'TX, Dallas',
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-location-cell')
      const bolded = cell.querySelectorAll('b')
      expect(bolded).toHaveLength(1)
      expect(bolded[0]).toHaveTextContent('TX')
      expect(cell).toHaveTextContent('TX, Dallas')
    })

    it('leaves a confirmed location plain when the leading token is not a 2-letter state', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableLocation: 'Home base',
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-location-cell')
      expect(cell.querySelectorAll('b')).toHaveLength(0)
      expect(cell).toHaveTextContent('Home base')
    })
  })

  it('renders the current trip as an unbolded badge link to the trip screen', () => {
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
    // The badge inside the link picks up font-normal (no shadcn font-semibold).
    const badge = link.querySelector('[class*="font-normal"]')
    expect(badge).toBeTruthy()
    expect(link.querySelector('[class*="font-semibold"]')).toBeFalsy()
  })

  it('renders the driver name and zone filters', () => {
    driverPlanningReturn = {
      data: [makeDriver()],
      isLoading: false,
      isError: false,
    }
    renderPage()
    expect(screen.getByPlaceholderText(/filter by driver name/i)).toBeInTheDocument()
    expect(screen.getByTestId('driver-zone-filter')).toBeInTheDocument()
  })

  describe('zone filter', () => {
    const stateList = [
      { geo_code: 'TX', geo_name: 'Texas', zone: 'SW' },
      { geo_code: 'NY', geo_name: 'New York', zone: 'NE' },
      { geo_code: 'CA', geo_name: 'California', zone: 'W' },
    ]
    const zoneList = [
      { zone_code: 'SW', zone_description: 'Southwest' },
      { zone_code: 'NE', zone_description: 'Northeast' },
      { zone_code: 'W', zone_description: 'West' },
    ]

    it('narrows the visible rows to drivers whose ready state maps to a selected zone', () => {
      driverPlanningReturn = {
        data: [
          // Alice → TX (Southwest)
          makeDriver({
            driverId: 1,
            driverName: 'Alice',
            deliveries: [delivery({ state: 'TX', actualDate: '2026-06-02' })],
          }),
          // Bob → NY (Northeast)
          makeDriver({
            driverId: 2,
            driverName: 'Bob',
            deliveries: [delivery({ activityId: 9, state: 'NY', actualDate: '2026-06-02' })],
          }),
          // Carol → CA (West)
          makeDriver({
            driverId: 3,
            driverName: 'Carol',
            deliveries: [delivery({ activityId: 8, state: 'CA', actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage({ common: { stateList, zoneList } })

      // Default: all three visible.
      expect(screen.getAllByTestId('driver-row')).toHaveLength(3)

      // Pick the Southwest zone — only Alice should remain.
      const zoneFilter = screen.getByTestId('driver-zone-filter')
      const combobox = within(zoneFilter).getByRole('combobox')
      fireEvent.mouseDown(combobox)
      fireEvent.focus(combobox)
      fireEvent.click(screen.getByText('Southwest'))

      const rows = screen.getAllByTestId('driver-row')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.getAttribute('data-driver-id')).toBe('1')
    })
  })

  describe('Ready Date sort', () => {
    it('sorts ascending on first click and descending on the second; nulls stay last', () => {
      driverPlanningReturn = {
        data: [
          // Alice — June 5 (estimated)
          makeDriver({
            driverId: 1,
            driverName: 'Alice',
            deliveries: [delivery({ actualDate: null, estimatedDate: '2026-06-05' })],
          }),
          // Bob — June 2 (estimated)
          makeDriver({
            driverId: 2,
            driverName: 'Bob',
            deliveries: [
              delivery({ activityId: 9, actualDate: null, estimatedDate: '2026-06-02' }),
            ],
          }),
          // Carol — no deliveries, no confirmed → no ready date.
          makeDriver({ driverId: 3, driverName: 'Carol', deliveries: [] }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()

      const header = screen.getByTestId('ready-date-header')

      // Click 1 — asc: Bob (Jun 2) → Alice (Jun 5) → Carol (null last).
      fireEvent.click(header)
      let rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['2', '1', '3'])
      expect(screen.getByTestId('ready-date-sort-icon').getAttribute('data-sort-order')).toBe('asc')

      // Click 2 — desc: Alice → Bob → Carol (null still last).
      fireEvent.click(header)
      rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['1', '2', '3'])
      expect(screen.getByTestId('ready-date-sort-icon').getAttribute('data-sort-order')).toBe(
        'desc',
      )
    })
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
    it('shows the confirmed ready date bold with a calendar-check icon, formatted MM/DD', () => {
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
      // Ready Date renders MM/DD (US date order), not DD/MM.
      expect(cell).toHaveTextContent('07/01')
    })

    it('marks an estimated guess with the estimated tier', () => {
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
    })

    it('marks a spread-only guess with the spread tier', () => {
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
    })

    it('marks an actual guess with the actual tier', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-15' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('actual')
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

    it('shows the actual date when present (priority 1)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-03',
                estimatedDate: '2026-06-02',
                actualDate: '2026-06-04',
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/04')
      expect(eff.className).toMatch(/font-semibold/)
    })

    it('falls back to estimated when there is no actual (priority 2)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-05',
                estimatedDate: '2026-06-03',
                actualDate: null,
                isConfirmed: true,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/03')
      expect(eff.className).toMatch(/font-semibold/)
      // The confidence color lives on the icon, not the date — keep the date
      // neutral so dispatchers only parse one color signal per row.
      expect(eff.className).not.toMatch(/text-emerald-/)
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.className).toMatch(/text-emerald-/)
    })

    it('falls back to spread start when there is no actual or estimated (priority 3)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-05',
                estimatedDate: null,
                actualDate: null,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const eff = screen.getByTestId('delivery-effective')
      expect(eff).toHaveTextContent('06/01')
    })

    it('renders phone + SMS quick-actions on every row, regardless of the date tier', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({ activityId: 1, actualDate: '2026-06-04' }),
              delivery({
                activityId: 2,
                actualDate: null,
                estimatedDate: null,
                plannedStart: null,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const lines = screen.getAllByTestId('delivery-line')
      for (const line of lines) {
        expect(within(line).getByTestId('delivery-call').getAttribute('href')).toBe(
          'tel:+12345678910',
        )
        expect(within(line).getByTestId('delivery-sms').getAttribute('href')).toBe(
          'sms:+12345678910',
        )
      }
    })

    it('places the confidence icon immediately after the date cell (not after the city)', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-02' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('delivery-line')
      const cells = Array.from(line.querySelectorAll('td'))
      // Column order: state | date | icon | city | call/sms.
      const effIdx = cells.findIndex((c) => c.querySelector('[data-testid="delivery-effective"]'))
      const iconIdx = cells.findIndex((c) => c.querySelector('[data-testid="delivery-icon"]'))
      const cityIdx = cells.findIndex((c) => c.textContent?.includes('Dallas'))
      expect(effIdx).toBeGreaterThanOrEqual(0)
      expect(iconIdx).toBe(effIdx + 1)
      expect(cityIdx).toBe(iconIdx + 1)
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

  // -------------------------------------------------------------------------
  // Variant B — planner-oriented driver roster. Re-pin the random variant pick
  // to V-B (Math.floor(0.5 * 3) = 1) so renderPage() mounts the roster.
  // -------------------------------------------------------------------------
  describe('Variant B roster', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })

    it('renders the roster headers and Driver Code / Agency from driver data', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 4502, driverName: 'Hauler, Alice', agentCode: '1545' })],
        isLoading: false,
        isError: false,
      }
      renderPage()

      // Scope to the table — "Zone" also appears in the zone-filter placeholder.
      const table = within(screen.getByTestId('driver-table'))
      for (const header of [
        'Driver Name',
        'Driver Code',
        'State',
        'Zone',
        'Empty Date',
        'Canada?',
        'California?',
        'Rating',
        'Equipment',
        'Notes',
        'Home City',
        'Home State',
        'Agency',
      ]) {
        expect(table.getByText(header)).toBeInTheDocument()
      }
      expect(screen.getByTestId('driver-code')).toHaveTextContent('4502')
      expect(screen.getByTestId('driver-agency')).toHaveTextContent('1545')
    })

    it('falls back to the 1111 placeholder when the driver has no agent code', () => {
      driverPlanningReturn = {
        data: [makeDriver({ agentCode: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByTestId('driver-agency')).toHaveTextContent('1111')
    })

    it('colours the driver-name cell by agency', () => {
      driverPlanningReturn = {
        data: [makeDriver({ agentCode: '1511' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByTestId('driver-name').className).toMatch(/bg-red-300/)
    })

    it('derives State and Zone from the ready location / stateList', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableLocation: 'Austin, TX' })],
        isLoading: false,
        isError: false,
      }
      renderPage({ common: { stateList: [{ geo_code: 'TX', geo_name: 'Texas', zone: 'SW' }] } })
      expect(screen.getByTestId('driver-state')).toHaveTextContent('TX')
      expect(screen.getByTestId('driver-zone')).toHaveTextContent('SW')
    })

    it('toggles Canada on click, commits canada:true, and highlights the cell yellow', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 9, canada: false })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('driver-canada')
      expect(cell.className).not.toMatch(/bg-yellow-200/)
      fireEvent.click(cell)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 9, canada: true }),
        expect.anything(),
      )
      expect(screen.getByTestId('driver-canada').className).toMatch(/bg-yellow-200/)
      expect(screen.getByTestId('driver-canada')).toHaveTextContent('Yes')
    })

    it('highlights Rating red when below 4.5', () => {
      driverPlanningReturn = {
        data: [makeDriver({ rating: 4.2 })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('driver-rating')
      expect(cell.className).toMatch(/bg-red-200/)
      expect(cell.className).toMatch(/text-red-700/)
    })

    it('does not highlight Rating at or above 4.5', () => {
      driverPlanningReturn = {
        data: [makeDriver({ rating: 4.8 })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.getByTestId('driver-rating').className).not.toMatch(/bg-red-200/)
    })

    it('commits the edited Rating via the mutation on blur', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 7, rating: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('driver-rating'))
      const input = screen.getByTestId('confirmed-rating-input')
      fireEvent.change(input, { target: { value: '4.9' } })
      fireEvent.blur(input)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 7, rating: 4.9 }),
        expect.anything(),
      )
    })

    it('commits a selected Equipment value', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 3, equipment: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('driver-equipment'))
      const select = screen.getByTestId('confirmed-equipment-select')
      fireEvent.change(select, { target: { value: 'Straight Truck' } })
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 3, equipment: 'Straight Truck' }),
        expect.anything(),
      )
    })
  })
})
