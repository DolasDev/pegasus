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
import { AvailabilityViewB } from '@/features/driver-planning/availability/AvailabilityViewB'
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

// The page renders View A by default; the Change View tab switches to View B in
// the browser (exercised by the e2e AvailabilityPage.pinVariant via a real click).
// Radix's tab activation doesn't fire under jsdom's synthetic fireEvent, so the
// Variant B roster suite renders View B directly — it is the component under test,
// and the page-level wiring (default A, C tab gone) is covered separately above.
function renderVariantB(preloadedState: PartialTestRootState = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const store = makeTestStore(preloadedState)
  return render(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <AvailabilityViewB />
      </QueryClientProvider>
    </Provider>,
  )
}

function makeDriver(overrides?: Partial<DriverPlanningRow>): DriverPlanningRow {
  const base: DriverPlanningRow = {
    driverId: 1,
    driverName: 'Driver, Alice',
    agentCode: 'A1',
    currentTripId: null,
    currentTripTitle: null,
    estimatedAvailableDate: '2026-06-01',
    estimatedAvailableLocation: 'Dallas, TX',
    // Default confirmed date inside the default A/B/C date-range filter
    // (today ±3 months); tests that exercise the no-confirmed-date branch
    // override this to null and bring their own shipments/deliveries.
    confirmedAvailableDate: '2026-06-01',
    confirmedAvailableLocation: null,
    confirmedNotes: null,
    canada: false,
    california: false,
    rating: null,
    equipment: null,
    homeCity: null,
    homeState: null,
    wgs: null,
    isLocal: false,
    isLongDistance: true,
    deliveries: [],
    shipments: [],
    ...overrides,
  }
  // Mirror `deliveries` into `shipments` (one synthetic shipment per delivery)
  // when callers only supplied deliveries, so Variant A's Deliveries column —
  // which now reads `shipments` — keeps producing the same row count without
  // every fixture having to spell both lists.
  if (!overrides?.shipments && overrides?.deliveries) {
    base.shipments = overrides.deliveries.map((d, i) => ({ ...d, orderNum: 9000 + i }))
  }
  return base
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
    // The page renders View A by default (no random pick), so these suites — which
    // assert View A's columns/cells — need no variant pinning. View B has diverged
    // into a roster and is covered by its own describe block, which switches to it
    // via the Change View tab.
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

  it('renders View A by default and drops the retired Variant C tab', () => {
    driverPlanningReturn = { data: [makeDriver()], isLoading: false, isError: false }
    renderPage()

    // View A owns the split "Ready City" / "Deliveries" columns; if View B (roster)
    // had mounted instead there would be no "Ready City" header.
    const table = within(screen.getByTestId('driver-table'))
    expect(table.getByText('Ready City')).toBeInTheDocument()
    expect(table.getByText('Deliveries')).toBeInTheDocument()

    // The Change View control keeps A and B; Variant C is gone.
    expect(screen.getByTestId('availability-view-tab-A')).toBeInTheDocument()
    expect(screen.getByTestId('availability-view-tab-B')).toBeInTheDocument()
    expect(screen.queryByTestId('availability-view-tab-C')).not.toBeInTheDocument()
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

    // Headers — Ready Location split into Ready State + Ready City; Variant A
    // drops Current Trip (the Deliveries cell links to it instead). The seven
    // roster columns (Canada?…Home City) sit after Notes; the Contact column
    // was removed (its phone/SMS icons moved into the Driver cell).
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Ready Date')).toBeInTheDocument()
    expect(screen.getByText('Ready State')).toBeInTheDocument()
    expect(screen.getByText('Ready City')).toBeInTheDocument()
    expect(screen.getByText('Deliveries')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Canada?')).toBeInTheDocument()
    expect(screen.getByText('California?')).toBeInTheDocument()
    expect(screen.getByText('WGS')).toBeInTheDocument()
    expect(screen.getByText('Rating')).toBeInTheDocument()
    expect(screen.getByText('Equipment')).toBeInTheDocument()
    expect(screen.getByText('Home State')).toBeInTheDocument()
    expect(screen.getByText('Home City')).toBeInTheDocument()
    expect(screen.queryByText('Contact')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready Location')).not.toBeInTheDocument()
    expect(screen.queryByText('Current Trip')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmed Date')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirmed Location')).not.toBeInTheDocument()

    // Rows — names render as "Last, F.".
    expect(screen.getByText('Driver, A.')).toBeInTheDocument()
    expect(screen.getByText('Driver, B.')).toBeInTheDocument()
  })

  it('formats the driver name as "Last, F.", not bold, with the phone + SMS icons in front of it', () => {
    driverPlanningReturn = {
      data: [makeDriver({ driverName: 'Smith, John' })],
      isLoading: false,
      isError: false,
    }
    renderPage()
    const cell = screen.getByTestId('driver-name')
    expect(cell).toHaveTextContent('Smith, J.')
    // Name is no longer bold in Variant A.
    expect(cell.className).not.toMatch(/font-bold/)
    // The quick-action icons live in the Driver cell, now BEFORE the name.
    const call = within(cell).getByTestId('driver-call')
    const sms = within(cell).getByTestId('driver-sms')
    expect(call).toBeInTheDocument()
    expect(sms).toBeInTheDocument()
    // DOM order: call → sms → name. compareDocumentPosition FOLLOWING = 4.
    const nameNode = within(cell).getByText('Smith, J.')
    expect(call.compareDocumentPosition(nameNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sms.compareDocumentPosition(nameNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tints the driver-name cell by agency and exposes the agency via data-agency + tooltip', async () => {
    driverPlanningReturn = {
      data: [makeDriver({ driverName: 'Hauler, Bob', agentCode: '1295' })],
      isLoading: false,
      isError: false,
    }
    renderPage()
    const cell = screen.getByTestId('driver-name')
    // Agency 1295 → yellow highlight (AGENCY_BG), agency surfaced for the tooltip.
    expect(cell.className).toMatch(/bg-yellow-200/)
    expect(cell).toHaveAttribute('data-agency', '1295')
    // Hover reveals the "Agency: …" tooltip (HoverToolTip renders content on hover).
    fireEvent.mouseEnter(within(cell).getByText('Hauler, B.'))
    expect(await screen.findByText('Agency: 1295')).toBeInTheDocument()
  })

  describe('ready state / ready city columns', () => {
    it('shows the best-guess city/state from the activity when the Ready Date is not manually entered', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            // No confirmed availability at all → the whole triple is the guess,
            // so state/city come from the same activity the guess date did.
            confirmedAvailableDate: null,
            confirmedAvailableLocation: null,
            deliveries: [delivery({ city: 'EL PASO', state: 'TX', actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const stateCell = screen.getByTestId('ready-state-cell')
      const cityCell = screen.getByTestId('ready-city-cell')
      // State code renders bold in its own column.
      const stateBold = stateCell.querySelectorAll('b')
      expect(stateBold).toHaveLength(1)
      expect(stateBold[0]).toHaveTextContent('TX')
      expect(cityCell).toHaveTextContent('El Paso')
    })

    it('shows no ready state/city when the Ready Date is manually entered but no location was', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            // Manual (confirmed) date, but the planner left the location blank.
            // State/city must reflect the manual entry (empty) — NOT the last
            // activity — so they stay in lockstep with the displayed date.
            confirmedAvailableDate: '2026-06-01',
            confirmedAvailableLocation: null,
            deliveries: [delivery({ city: 'EL PASO', state: 'TX', actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const stateCell = screen.getByTestId('ready-state-cell')
      const cityCell = screen.getByTestId('ready-city-cell')
      expect(stateCell).toHaveTextContent('-')
      expect(stateCell.querySelectorAll('b')).toHaveLength(0)
      expect(cityCell).toHaveTextContent('-')
    })

    it('keeps the manually-entered state/city even when the last activity is elsewhere', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: '2026-06-01',
            confirmedAvailableLocation: 'TX, Dallas',
            // A competing activity in a different place must not bleed through.
            deliveries: [delivery({ city: 'FRESNO', state: 'CA', actualDate: '2026-06-02' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const stateCell = screen.getByTestId('ready-state-cell')
      const cityCell = screen.getByTestId('ready-city-cell')
      expect(stateCell).toHaveTextContent('TX')
      expect(cityCell).toHaveTextContent('Dallas')
      expect(cityCell).not.toHaveTextContent('Fresno')
    })

    it('splits a "STATE, City" confirmed location across the two columns', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableLocation: 'TX, Dallas' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const stateCell = screen.getByTestId('ready-state-cell')
      const cityCell = screen.getByTestId('ready-city-cell')
      expect(stateCell.querySelectorAll('b')).toHaveLength(1)
      expect(stateCell).toHaveTextContent('TX')
      expect(cityCell).toHaveTextContent('Dallas')
    })

    it('puts a non-2-letter prefix entirely into the city column', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableLocation: 'Home base' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const stateCell = screen.getByTestId('ready-state-cell')
      const cityCell = screen.getByTestId('ready-city-cell')
      // No state code parsed → state column shows the placeholder.
      expect(stateCell).toHaveTextContent('-')
      expect(stateCell.querySelectorAll('b')).toHaveLength(0)
      expect(cityCell).toHaveTextContent('Home base')
    })
  })

  it('wraps the Deliveries table in a link to the current trip', () => {
    driverPlanningReturn = {
      data: [
        makeDriver({
          driverId: 7,
          driverName: 'Gary',
          currentTripId: 42,
          currentTripTitle: 'Houston Run',
          deliveries: [delivery({ city: 'HOUSTON', state: 'TX', actualDate: '2026-06-02' })],
        }),
      ],
      isLoading: false,
      isError: false,
    }
    renderPage()
    // Current Trip column is gone in Variant A; the whole Deliveries table is
    // a click-through to the trip detail screen instead.
    expect(screen.queryByTestId('current-trip-link')).not.toBeInTheDocument()
    const link = screen.getByTestId('deliveries-trip-link')
    expect(link.getAttribute('href')).toBe('/driver-planning/trips/42')
    // The shipment line still renders inside the link.
    expect(link.querySelector('[data-testid="shipment-line"]')).toBeTruthy()
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
          // Ready state is derived from the guess activity, so these rows carry
          // no confirmed availability — their zone comes from the delivery state.
          // Alice → TX (Southwest)
          makeDriver({
            driverId: 1,
            driverName: 'Alice',
            confirmedAvailableDate: null,
            deliveries: [delivery({ state: 'TX', actualDate: '2026-06-02' })],
          }),
          // Bob → NY (Northeast)
          makeDriver({
            driverId: 2,
            driverName: 'Bob',
            confirmedAvailableDate: null,
            deliveries: [delivery({ activityId: 9, state: 'NY', actualDate: '2026-06-02' })],
          }),
          // Carol → CA (West)
          makeDriver({
            driverId: 3,
            driverName: 'Carol',
            confirmedAvailableDate: null,
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

  describe('move-type filters (Local / Long Distance)', () => {
    // Three drivers spanning every combination; all carry the default confirmed
    // date so they sit inside the default ready-date range window.
    function seedMoveTypeDrivers() {
      driverPlanningReturn = {
        data: [
          makeDriver({
            driverId: 1,
            driverName: 'LocalOnly',
            isLocal: true,
            isLongDistance: false,
          }),
          makeDriver({ driverId: 2, driverName: 'LongOnly', isLocal: false, isLongDistance: true }),
          makeDriver({ driverId: 3, driverName: 'Both', isLocal: true, isLongDistance: true }),
        ],
        isLoading: false,
        isError: false,
      }
    }
    const visibleIds = () =>
      screen.getAllByTestId('driver-row').map((r) => r.getAttribute('data-driver-id'))

    it('shows every driver when both filters are on "Any" (the default)', () => {
      seedMoveTypeDrivers()
      renderPage()
      expect(visibleIds()).toEqual(['1', '2', '3'])
    })

    it('Local = Yes keeps only drivers who handle local moves', () => {
      seedMoveTypeDrivers()
      renderPage()
      fireEvent.change(screen.getByTestId('local-filter'), { target: { value: 'yes' } })
      expect(visibleIds()).toEqual(['1', '3'])
    })

    it('Local = No keeps only drivers who do not handle local moves', () => {
      seedMoveTypeDrivers()
      renderPage()
      fireEvent.change(screen.getByTestId('local-filter'), { target: { value: 'no' } })
      expect(visibleIds()).toEqual(['2'])
    })

    it('Long Distance = Yes keeps only long-distance drivers', () => {
      seedMoveTypeDrivers()
      renderPage()
      fireEvent.change(screen.getByTestId('long-dist-filter'), { target: { value: 'yes' } })
      expect(visibleIds()).toEqual(['2', '3'])
    })

    it('combines both filters — Local=Yes AND Long Distance=Yes keeps only the driver who does both', () => {
      seedMoveTypeDrivers()
      renderPage()
      fireEvent.change(screen.getByTestId('local-filter'), { target: { value: 'yes' } })
      fireEvent.change(screen.getByTestId('long-dist-filter'), { target: { value: 'yes' } })
      expect(visibleIds()).toEqual(['3'])
    })
  })

  describe('Ready Date sort', () => {
    it('defaults to ascending (earliest first) and toggles to descending on header click', () => {
      driverPlanningReturn = {
        data: [
          // Alice — June 5 (estimated)
          makeDriver({
            driverId: 1,
            driverName: 'Alice',
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: null, estimatedDate: '2026-06-05' })],
          }),
          // Bob — June 2 (estimated)
          makeDriver({
            driverId: 2,
            driverName: 'Bob',
            confirmedAvailableDate: null,
            deliveries: [
              delivery({ activityId: 9, actualDate: null, estimatedDate: '2026-06-02' }),
            ],
          }),
          // Carol — June 8 (estimated). She used to be the "no date" tail row,
          // but the default date-range filter now hides drivers with no
          // calculated date, so we give her a date inside the window instead.
          makeDriver({
            driverId: 3,
            driverName: 'Carol',
            confirmedAvailableDate: null,
            deliveries: [
              delivery({ activityId: 7, actualDate: null, estimatedDate: '2026-06-08' }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()

      // Default sort is 'asc' (earliest first) on mount — Bob → Alice → Carol.
      let rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['2', '1', '3'])
      expect(screen.getByTestId('ready-date-sort-icon').getAttribute('data-sort-order')).toBe('asc')

      // Click 1 — toggles to desc: Carol → Alice → Bob.
      const header = screen.getByTestId('ready-date-header')
      fireEvent.click(header)
      rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['3', '1', '2'])
      expect(screen.getByTestId('ready-date-sort-icon').getAttribute('data-sort-order')).toBe(
        'desc',
      )

      // Click 2 — back to asc.
      fireEvent.click(header)
      rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['2', '1', '3'])
      expect(screen.getByTestId('ready-date-sort-icon').getAttribute('data-sort-order')).toBe('asc')
    })

    it('applies a today ±3 months date-range filter by default; clearing both bounds shows every driver', () => {
      driverPlanningReturn = {
        data: [
          // In range — June 5 (≈ today)
          makeDriver({ driverId: 1, driverName: 'InRange', confirmedAvailableDate: '2026-06-05' }),
          // Far future — outside the +3mo bound.
          makeDriver({ driverId: 2, driverName: 'Far', confirmedAvailableDate: '2027-01-01' }),
          // No calculated date at all → also excluded by the filter.
          makeDriver({
            driverId: 3,
            driverName: 'Unknown',
            confirmedAvailableDate: null,
            deliveries: [],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()

      // Default range hides the far-future driver and the no-date driver.
      let rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['1'])

      // Clearing both bounds disables the range filter and shows every driver
      // (still sorted asc, nulls last).
      fireEvent.change(screen.getByTestId('ready-date-from'), { target: { value: '' } })
      fireEvent.change(screen.getByTestId('ready-date-to'), { target: { value: '' } })
      rows = screen.getAllByTestId('driver-row')
      expect(rows.map((r) => r.getAttribute('data-driver-id'))).toEqual(['1', '2', '3'])
    })
  })

  describe('click-to-edit fields', () => {
    it('opens linked date/state/city inputs when any of the three cells is clicked', () => {
      driverPlanningReturn = { data: [makeDriver()], isLoading: false, isError: false }
      renderPage()
      expect(screen.queryByTestId('confirmed-date-input')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('ready-date-cell'))
      // All three inputs render together — they're a linked edit group.
      expect(screen.getByTestId('confirmed-date-input')).toBeInTheDocument()
      expect(screen.getByTestId('confirmed-state-input')).toBeInTheDocument()
      expect(screen.getByTestId('confirmed-city-input')).toBeInTheDocument()
    })

    it('also opens the linked group when Ready State or Ready City is clicked', () => {
      driverPlanningReturn = { data: [makeDriver()], isLoading: false, isError: false }
      renderPage()
      fireEvent.click(screen.getByTestId('ready-state-cell'))
      expect(screen.getByTestId('confirmed-date-input')).toBeInTheDocument()
      expect(screen.getByTestId('confirmed-state-input')).toBeInTheDocument()
      expect(screen.getByTestId('confirmed-city-input')).toBeInTheDocument()
    })

    it('refuses to save until date AND state AND city are all populated', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            driverId: 5,
            confirmedAvailableDate: null,
            confirmedAvailableLocation: null,
            deliveries: [],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      // Driver was filtered out by default date range — clear the range so the
      // row mounts with empty linked-group fields.
      fireEvent.change(screen.getByTestId('ready-date-from'), { target: { value: '' } })
      fireEvent.change(screen.getByTestId('ready-date-to'), { target: { value: '' } })

      fireEvent.click(screen.getByTestId('ready-date-cell'))
      const dateInput = screen.getByTestId('confirmed-date-input')
      const stateInput = screen.getByTestId('confirmed-state-input')
      const cityInput = screen.getByTestId('confirmed-city-input')

      // Date only → blur attempts to commit but is a no-op; inputs stay open.
      fireEvent.change(dateInput, { target: { value: '2026-07-04' } })
      fireEvent.blur(dateInput)
      expect(mutateMock).not.toHaveBeenCalled()
      expect(screen.getByTestId('confirmed-date-input')).toBeInTheDocument()

      // Adding state alone still isn't enough.
      fireEvent.change(stateInput, { target: { value: 'CA' } })
      fireEvent.blur(stateInput)
      expect(mutateMock).not.toHaveBeenCalled()

      // City completes the triple → mutation fires with all three packed in.
      fireEvent.change(cityInput, { target: { value: 'Fresno' } })
      fireEvent.blur(cityInput)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          driverId: 5,
          confirmedDate: '2026-07-04',
          confirmedLocation: 'CA, Fresno',
        }),
        expect.anything(),
      )
    })

    it('clearing a previously-confirmed ready date commits null date AND null location', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            driverId: 7,
            confirmedAvailableDate: '2026-07-04',
            confirmedAvailableLocation: 'CA, Fresno',
            deliveries: [],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()

      // Row is confirmed, so the date cell opens the linked inputs on click.
      fireEvent.click(screen.getByTestId('ready-date-cell'))
      const dateInput = screen.getByTestId('confirmed-date-input')

      // Clear the date via the calendar UI and blur — date + location are one
      // linked unit, so clearing the date clears the whole confirmed availability.
      fireEvent.change(dateInput, { target: { value: '' } })
      fireEvent.blur(dateInput)

      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          driverId: 7,
          confirmedDate: null,
          confirmedLocation: null,
        }),
        expect.anything(),
      )
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
      expect(cell.className).toMatch(/font-bold/)
      expect(cell.querySelector('.fa-calendar-check')).toBeTruthy()
      // Ready Date renders MM/DD (US date order), not DD/MM.
      expect(cell).toHaveTextContent('07/01')
    })

    it('marks an estimated guess with the estimated tier', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: null, estimatedDate: '2026-06-09' })],
          }),
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
            confirmedAvailableDate: null,
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
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: '2026-06-15' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const cell = screen.getByTestId('ready-date-cell')
      expect(cell.getAttribute('data-ready-tier')).toBe('actual')
    })
  })

  // The Ready Date icon must speak the SAME glyph vocabulary as the delivery
  // rows below it and the planning screen's Gantt bars — it once kept a private
  // ladder that drifted until actual/estimated rendered each other's icon.
  describe('ready date icons match the shared confidence vocabulary', () => {
    function readyIcon() {
      return screen.getByTestId('ready-tier-icon')
    }

    it('renders the truck icon (emerald-700) when the ready date is actualized', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: '2026-06-15' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(readyIcon().getAttribute('data-icon')).toBe('fa-truck-moving')
      expect(readyIcon().className).toMatch(/text-emerald-700/)
    })

    it('renders the flag icon (emerald-600) when the source activity is confirmed', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: null, isConfirmed: true })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(readyIcon().getAttribute('data-icon')).toBe('fa-flag-checkered')
      expect(readyIcon().className).toMatch(/text-emerald-600/)
    })

    it('renders the check icon (emerald-500) when the source activity is committed only', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: null, isCommitted: true })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(readyIcon().getAttribute('data-icon')).toBe('fa-check')
      expect(readyIcon().className).toMatch(/text-emerald-500/)
    })

    it('renders the question icon (muted) for a planned-spread ready date', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [
              delivery({ actualDate: null, estimatedDate: null, plannedEnd: '2026-06-10' }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(readyIcon().getAttribute('data-icon')).toBe('fa-question')
      expect(readyIcon().className).toMatch(/text-muted-foreground/)
    })

    it('renders NO icon for a bare ETA with nothing committed behind it', () => {
      // Matches the Gantt and the delivery rows, where an unconfirmed estimate
      // is drawn without an icon. The date still shows; only the badge is gone.
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [
              delivery({
                actualDate: null,
                estimatedDate: '2026-06-09',
                isCommitted: false,
                isConfirmed: false,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      expect(screen.queryByTestId('ready-tier-icon')).not.toBeInTheDocument()
      expect(screen.getByTestId('ready-date-cell')).toHaveTextContent('06/09')
    })

    it('never reuses a delivery-row glyph for the planner-entered availability date', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableDate: '2026-07-01' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      // A hand-entered availability date is not an activity date, so it keeps
      // its own calendar glyph rather than borrowing the "confirmed" flag.
      expect(readyIcon().getAttribute('data-icon')).toBe('fa-calendar-check')
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
      expect(screen.queryByTestId('shipment-line')).not.toBeInTheDocument()
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
      const lines = screen.getAllByTestId('shipment-line')
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
      // Shipment rows are no longer bold — every cell inherits the regular weight.
      expect(eff.className).not.toMatch(/font-bold/)
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
      expect(eff.className).not.toMatch(/font-bold/)
      // Confidence icons are now per-tier emerald (ported from View C); a
      // confirmed delivery paints emerald-600.
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.className).toMatch(/text-emerald-600/)
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

    it('renders one phone + SMS quick-action pair per driver row, inside the Driver cell', () => {
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
      // The Contact column was removed; icons live in the Driver cell, not per delivery.
      const lines = screen.getAllByTestId('shipment-line')
      for (const line of lines) {
        expect(within(line).queryByTestId('delivery-call')).toBeNull()
        expect(within(line).queryByTestId('delivery-sms')).toBeNull()
      }
      expect(screen.queryByTestId('driver-contact')).toBeNull()
      const driverCell = screen.getByTestId('driver-name')
      expect(within(driverCell).getByTestId('driver-call').getAttribute('href')).toBe(
        'tel:+12345678910',
      )
      // SMS hands off to the pegasus-desktop:// app via an onClick handler
      // (smsDriver util) — href is the placeholder `#` and the driver code
      // travels through `data-driver-code` on the anchor.
      const sms = within(driverCell).getByTestId('driver-sms')
      expect(sms.getAttribute('href')).toBe('#')
      expect(sms.getAttribute('data-driver-code')).not.toBeNull()
    })

    it('orders the shipment cells date | state | icon', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-02' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('shipment-line')
      const cells = Array.from(line.querySelectorAll('td'))
      const effIdx = cells.findIndex((c) => c.querySelector('[data-testid="delivery-effective"]'))
      // delivery-state testid is on the <td> itself, not a descendant.
      const stateIdx = cells.findIndex((c) => c.getAttribute('data-testid') === 'delivery-state')
      const iconIdx = cells.findIndex((c) => c.querySelector('[data-testid="delivery-icon"]'))
      // The indicator icon moved from first to LAST; the city column is gone.
      expect(effIdx).toBeGreaterThanOrEqual(0)
      expect(stateIdx).toBe(effIdx + 1)
      expect(iconIdx).toBe(stateIdx + 1)
      expect(iconIdx).toBe(cells.length - 1)
    })

    it('renders the truck icon (emerald-700) for an actual_date delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ actualDate: '2026-06-02' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-truck-moving')
      expect(icon.className).toMatch(/text-emerald-700/)
    })

    it('renders the flag icon (emerald-600) for a confirmed-but-not-actualised delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ isConfirmed: true })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-flag-checkered')
      expect(icon.className).toMatch(/text-emerald-600/)
    })

    it('renders the check icon (emerald-500) for a committed-only delivery', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ isCommitted: true })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-check')
      expect(icon.className).toMatch(/text-emerald-500/)
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

    it('shows the state code inline and carries the title-cased city as a state tooltip', () => {
      driverPlanningReturn = {
        data: [makeDriver({ deliveries: [delivery({ city: 'EL PASO', state: 'TX' })] })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const line = screen.getByTestId('shipment-line')
      expect(line.textContent).toContain('TX')
      // City is no longer its own column — it lives on the state cell as a
      // (hover) tooltip, exposed for tests via data-city. It is NOT in the plain
      // un-hovered text.
      const stateCell = within(line).getByTestId('delivery-state')
      expect(stateCell).toHaveAttribute('data-city', 'El Paso')
      expect(line.textContent).not.toContain('El Paso')
      // State is no longer wrapped in <b> — shipment rows are weight-neutral.
      expect(line.querySelectorAll('b')).toHaveLength(0)
    })

    it('renders a question-mark icon when the date is a planned-spread fallback', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            deliveries: [
              delivery({
                plannedStart: '2026-06-01',
                plannedEnd: '2026-06-05',
                estimatedDate: null,
                actualDate: null,
                isConfirmed: false,
                isCommitted: false,
              }),
            ],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const icon = screen.getByTestId('delivery-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-question')
      // Spread is the least-certain tier → muted (View C has no spread tier).
      expect(icon.className).toMatch(/text-muted-foreground/)
    })
  })

  // -------------------------------------------------------------------------
  // Variant A roster columns — the seven planner fields ported from Variant B.
  // Every save sends the FULL field set (the PATCH upsert overwrites the whole
  // row), so a toggle/edit must not null out the untouched columns.
  // -------------------------------------------------------------------------
  describe('Variant A roster columns', () => {
    it('toggles Canada and commits the full field set with canada=true', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 7, canada: false, rating: 4.8, homeState: 'TX' })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('driver-canada'))
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          driverId: 7,
          canada: true,
          // Untouched roster fields ride along so the upsert can't wipe them.
          rating: 4.8,
          homeState: 'TX',
        }),
        expect.anything(),
      )
    })

    it('cycles WGS Maybe → Yes and commits wgs=true', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 8, wgs: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const wgs = screen.getByTestId('driver-wgs')
      expect(wgs).toHaveAttribute('data-wgs', 'maybe')
      fireEvent.click(wgs)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 8, wgs: true }),
        expect.anything(),
      )
    })

    it('color-codes WGS: green+bold for Yes, muted-red+bold for No, unstyled for Maybe', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({ driverId: 20, driverName: 'A, Yes', wgs: true }),
          makeDriver({ driverId: 21, driverName: 'B, No', wgs: false }),
          makeDriver({ driverId: 22, driverName: 'C, Maybe', wgs: null }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      const [yes, no, maybe] = screen.getAllByTestId('driver-wgs')
      expect(yes!.className).toMatch(/text-green-600/)
      expect(yes!.className).toMatch(/font-bold/)
      expect(no!.className).toMatch(/text-red-400/)
      expect(no!.className).toMatch(/font-bold/)
      // Maybe (unset) keeps the neutral formatting — no color, no bold.
      expect(maybe!.className).not.toMatch(/text-green-600|text-red-400|font-bold/)
    })

    it('edits Rating via click-to-edit and commits the parsed number on blur', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 9, rating: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('driver-rating'))
      const input = screen.getByTestId('confirmed-rating-input')
      fireEvent.change(input, { target: { value: '4.2' } })
      fireEvent.blur(input)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 9, rating: 4.2 }),
        expect.anything(),
      )
    })

    it('edits Home State via click-to-edit and commits it on blur', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 10, homeState: null })],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('driver-home-state'))
      const input = screen.getByTestId('confirmed-homeState-input')
      fireEvent.change(input, { target: { value: 'AZ' } })
      fireEvent.blur(input)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 10, homeState: 'AZ' }),
        expect.anything(),
      )
    })

    it('preserves the roster fields when editing Notes (no wipe)', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            driverId: 11,
            canada: true,
            california: true,
            rating: 4.9,
            equipment: 'Straight Truck',
            homeCity: 'Mesa',
            homeState: 'AZ',
            wgs: false,
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderPage()
      fireEvent.click(screen.getByTestId('notes-cell'))
      const input = screen.getByTestId('confirmed-notes-input')
      fireEvent.change(input, { target: { value: 'back Tuesday' } })
      fireEvent.blur(input)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          driverId: 11,
          notes: 'back Tuesday',
          canada: true,
          california: true,
          rating: 4.9,
          equipment: 'Straight Truck',
          homeCity: 'Mesa',
          homeState: 'AZ',
          wgs: false,
        }),
        expect.anything(),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Variant B — planner-oriented driver roster. The page defaults to View A, so
  // each test switches to View B via the Change View tab (renderVariantB).
  // -------------------------------------------------------------------------
  describe('Variant B roster', () => {
    it('renders the roster headers and Driver Code from driver data', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 4502, driverName: 'Hauler, Alice', agentCode: '1545' })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()

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
        'WGS',
        'Rating',
        'Equipment',
        'Notes',
        'Home City',
        'Home State',
      ]) {
        expect(table.getByText(header)).toBeInTheDocument()
      }
      expect(screen.getByTestId('driver-code')).toHaveTextContent('4502')
      // The agency column was removed; agency now lives on the driver-name cell.
      expect(screen.queryByTestId('driver-agency')).not.toBeInTheDocument()
    })

    it('colors the driver-name cell by agency and exposes the agency in a tooltip', async () => {
      driverPlanningReturn = {
        data: [makeDriver({ agentCode: '1511' })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
      const cell = screen.getByTestId('driver-name')
      expect(cell.className).toMatch(/bg-red-300/)
      expect(cell).toHaveAttribute('data-agency', '1511')

      // The styled tooltip reveals the agency on hover (400ms delay).
      fireEvent.mouseEnter(within(cell).getByText('Driver, A.').parentElement!)
      expect(await screen.findByText('Agency: 1511')).toBeInTheDocument()
    })

    it('uses the shared confidence glyphs on the Empty Date column', () => {
      driverPlanningReturn = {
        data: [
          makeDriver({
            confirmedAvailableDate: null,
            deliveries: [delivery({ actualDate: '2026-06-15' })],
          }),
        ],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
      const icon = screen.getByTestId('ready-tier-icon')
      expect(icon.getAttribute('data-icon')).toBe('fa-truck-moving')
      expect(icon.className).toMatch(/text-emerald-700/)
    })

    it('falls back to the 1111 placeholder in the agency tooltip when no agent code', () => {
      driverPlanningReturn = {
        data: [makeDriver({ agentCode: null })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
      expect(screen.getByTestId('driver-name')).toHaveAttribute('data-agency', '1111')
    })

    it('derives State and Zone from the ready location / stateList', () => {
      driverPlanningReturn = {
        data: [makeDriver({ confirmedAvailableLocation: 'Austin, TX' })],
        isLoading: false,
        isError: false,
      }
      renderVariantB({ common: { stateList: [{ geo_code: 'TX', geo_name: 'Texas', zone: 'SW' }] } })
      expect(screen.getByTestId('driver-state')).toHaveTextContent('TX')
      expect(screen.getByTestId('driver-zone')).toHaveTextContent('SW')
    })

    it('toggles Canada on click, commits canada:true, and highlights the cell yellow', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 9, canada: false })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
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

    it('cycles WGS Maybe -> Yes -> No -> Maybe and commits each state', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 11, wgs: null })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
      const cell = screen.getByTestId('driver-wgs')
      // Unset default is Maybe (question mark).
      expect(cell).toHaveAttribute('data-wgs', 'maybe')
      expect(cell).toHaveTextContent('?')

      fireEvent.click(cell)
      expect(mutateMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ driverId: 11, wgs: true }),
        expect.anything(),
      )
      expect(screen.getByTestId('driver-wgs')).toHaveAttribute('data-wgs', 'yes')

      fireEvent.click(screen.getByTestId('driver-wgs'))
      expect(mutateMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ driverId: 11, wgs: false }),
        expect.anything(),
      )
      expect(screen.getByTestId('driver-wgs')).toHaveAttribute('data-wgs', 'no')

      fireEvent.click(screen.getByTestId('driver-wgs'))
      expect(mutateMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ driverId: 11, wgs: null }),
        expect.anything(),
      )
      expect(screen.getByTestId('driver-wgs')).toHaveAttribute('data-wgs', 'maybe')
    })

    it('highlights Rating red when below 4.5', () => {
      driverPlanningReturn = {
        data: [makeDriver({ rating: 4.2 })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
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
      renderVariantB()
      expect(screen.getByTestId('driver-rating').className).not.toMatch(/bg-red-200/)
    })

    it('commits the edited Rating via the mutation on blur', () => {
      driverPlanningReturn = {
        data: [makeDriver({ driverId: 7, rating: null })],
        isLoading: false,
        isError: false,
      }
      renderVariantB()
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
      renderVariantB()
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
