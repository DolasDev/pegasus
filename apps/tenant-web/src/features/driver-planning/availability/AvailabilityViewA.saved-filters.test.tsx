// ---------------------------------------------------------------------------
// View A saved filters — default seeding, Save, Load, Use as Default, Delete.
//
// Same harness strategy as routes/driver-planning.index.test.tsx: useQuery is
// dispatched by query key so each test controls the driver list, the user's
// default filter and the saved-filter list; the mutation hooks are spies.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AvailabilityViewA } from './AvailabilityViewA'
import type { DriverPlanningRow } from '@/api/queries/driver-planning'
import type { AvailabilityFilter, SavedAvailabilityQuery } from '@/api/queries/availability-filters'
import { makeTestStore } from '@/features/driver-planning/__test-utils__/render-with-store'
import { localTodayIso, toOffsetDays } from './availability-filter-query'

const { saveMock, setDefaultMock, deleteMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  setDefaultMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('@/api/queries/driver-planning', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/queries/driver-planning')
  return { ...actual, useUpdateConfirmedAvailability: () => ({ mutate: vi.fn() }) }
})

const mutation = (fn: ReturnType<typeof vi.fn>) => ({
  mutateAsync: fn,
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
})

vi.mock('@/api/queries/availability-filters', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/api/queries/availability-filters',
  )
  return {
    ...actual,
    useSaveAvailabilityFilter: () => mutation(saveMock),
    useSetDefaultAvailabilityFilter: () => mutation(setDefaultMock),
    useDeleteAvailabilityFilter: () => mutation(deleteMock),
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

let drivers: DriverPlanningRow[] = []
let defaultReturn: Record<string, unknown> = { data: null, isPending: false }
let mineList: AvailabilityFilter[] = []

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const [head, kind] = options.queryKey
      if (head === 'driver-planning') return { data: drivers, isLoading: false }
      if (head === 'availability-filters' && kind === 'default') return defaultReturn
      if (head === 'availability-filters') return { data: mineList, isLoading: false }
      return { data: undefined, isLoading: false }
    },
  }
})

const TODAY = localTodayIso()

function inDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localTodayIso(d)
}

function driver(id: number, name: string, overrides: Partial<DriverPlanningRow> = {}) {
  return {
    driverId: id,
    driverName: name,
    agentCode: null,
    currentTripId: null,
    currentTripTitle: null,
    estimatedAvailableDate: null,
    estimatedAvailableLocation: null,
    confirmedAvailableDate: inDays(5),
    confirmedAvailableLocation: 'TX, Dallas',
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
    isShorthaul: false,
    deliveries: [],
    shipments: [],
    ...overrides,
  } as DriverPlanningRow
}

const LOCAL_QUERY: SavedAvailabilityQuery = {
  v: 1,
  driverName: 'local',
  zones: [],
  moveTypes: ['local'],
  dateFromOffsetDays: null,
  dateToOffsetDays: null,
  sortOrder: 'asc',
}

function savedFilter(overrides: Partial<AvailabilityFilter> = {}): AvailabilityFilter {
  return {
    id: 'f1',
    name: 'Locals',
    query: LOCAL_QUERY,
    isPublic: false,
    isDefault: false,
    owner: { id: 'u1', email: 'me@test' },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

function renderView() {
  const qc = new QueryClient()
  return render(
    <Provider store={makeTestStore()}>
      <QueryClientProvider client={qc}>
        <AvailabilityViewA />
      </QueryClientProvider>
    </Provider>,
  )
}

function rowNames(): string[] {
  const table = screen.getByTestId('driver-table')
  return within(table)
    .queryAllByRole('row')
    .slice(1)
    .map((r) => r.textContent ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  drivers = [
    driver(1, 'Longhaul, Larry'),
    driver(2, 'Local, Lucy', { isLocal: true, isLongDistance: false }),
  ]
  defaultReturn = { data: null, isPending: false }
  mineList = []
  saveMock.mockResolvedValue(savedFilter())
  setDefaultMock.mockResolvedValue({ filterId: 'f1' })
  deleteMock.mockResolvedValue(null)
})

describe('default filter', () => {
  it('without a default, opens on the built-in filters (long distance)', () => {
    renderView()
    expect(rowNames().join()).toContain('Longhaul')
    expect(rowNames().join()).not.toContain('Local, L')
  })

  it('waits for the default instead of flashing the built-in filters', () => {
    defaultReturn = { data: undefined, isPending: true }
    renderView()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('driver-table')).not.toBeInTheDocument()
  })

  it('applies the saved default on first render', () => {
    defaultReturn = { data: savedFilter({ isDefault: true }), isPending: false }
    renderView()
    expect(screen.getByTestId('driver-filter')).toHaveValue('local')
    expect(rowNames().join()).toContain('Local, L')
    expect(rowNames().join()).not.toContain('Longhaul')
  })

  it('falls back to the built-in filters when the default cannot be read', () => {
    defaultReturn = { data: undefined, isPending: false, isError: true }
    renderView()
    expect(screen.getByTestId('driver-filter')).toHaveValue('')
    expect(rowNames().join()).toContain('Longhaul')
  })
})

describe('Save Filter', () => {
  it('saves the current filter bar as a relative query', async () => {
    renderView()
    fireEvent.change(screen.getByTestId('driver-filter'), { target: { value: 'Larry' } })
    fireEvent.change(screen.getByTestId('ready-date-from'), { target: { value: TODAY } })
    fireEvent.change(screen.getByTestId('ready-date-to'), { target: { value: '' } })

    fireEvent.click(screen.getByTestId('save-availability-filter'))
    const dialog = await screen.findByTestId('save-availability-filter-dialog')
    const submit = within(dialog).getByTestId('availability-filter-save-submit')
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByTestId('availability-filter-name'), {
      target: { value: 'My LD' },
    })
    fireEvent.click(within(dialog).getByTestId('availability-filter-public'))
    fireEvent.click(submit)

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith({
      name: 'My LD',
      isPublic: true,
      isDefault: false,
      query: {
        v: 1,
        driverName: 'Larry',
        zones: [],
        moveTypes: ['longDistance'],
        dateFromOffsetDays: 0,
        dateToOffsetDays: null,
        sortOrder: 'asc',
      },
    })
    await waitFor(() =>
      expect(screen.queryByTestId('save-availability-filter-dialog')).not.toBeInTheDocument(),
    )
  })
})

describe('Saved Filters dialog', () => {
  async function openAndSelect() {
    mineList = [savedFilter({ isDefault: true }), savedFilter({ id: 'f2', name: 'Other' })]
    renderView()
    fireEvent.click(screen.getByTestId('open-availability-filters'))
    const dialog = await screen.findByTestId('availability-filters-dialog')
    const rows = within(dialog).getAllByTestId('availability-filter-row')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Locals'),
      expect.stringContaining('Other'),
    ])
    expect(within(rows[0]!).getByTestId('availability-filter-default-star')).toBeInTheDocument()
    fireEvent.click(rows[0]!)
    return dialog
  }

  it('Load applies the filter to the page and closes', async () => {
    const dialog = await openAndSelect()
    fireEvent.click(within(dialog).getByTestId('availability-filter-load'))

    expect(screen.queryByTestId('availability-filters-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('driver-filter')).toHaveValue('local')
    expect(rowNames().join()).toContain('Local, L')
    expect(rowNames().join()).not.toContain('Longhaul')
  })

  it('Use as Default stores the default, then loads it', async () => {
    const dialog = await openAndSelect()
    fireEvent.click(within(dialog).getByTestId('availability-filter-use-default'))

    await waitFor(() => expect(setDefaultMock).toHaveBeenCalledWith('f1'))
    await waitFor(() => expect(screen.getByTestId('driver-filter')).toHaveValue('local'))
  })

  it('Delete asks for confirmation before deleting', async () => {
    const dialog = await openAndSelect()
    const del = within(dialog).getByTestId('availability-filter-delete')

    fireEvent.click(del)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(del).toHaveTextContent('Confirm Delete')

    fireEvent.click(del)
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('f1'))
  })

  it('loads relative dates against today', async () => {
    mineList = [
      savedFilter({
        query: { ...LOCAL_QUERY, driverName: '', dateFromOffsetDays: -7, dateToOffsetDays: 30 },
      }),
    ]
    renderView()
    fireEvent.click(screen.getByTestId('open-availability-filters'))
    const dialog = await screen.findByTestId('availability-filters-dialog')
    fireEvent.click(within(dialog).getByTestId('availability-filter-row'))
    fireEvent.click(within(dialog).getByTestId('availability-filter-load'))

    const from = (screen.getByTestId('ready-date-from') as HTMLInputElement).value
    const to = (screen.getByTestId('ready-date-to') as HTMLInputElement).value
    expect(toOffsetDays(from, TODAY)).toBe(-7)
    expect(toOffsetDays(to, TODAY)).toBe(30)
  })
})
