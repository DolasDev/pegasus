// ---------------------------------------------------------------------------
// Services filter bar: saved filters. Save posts the serialized board query,
// Load replaces the board query. The real query hooks run against a mocked
// apiFetch, so the request bodies asserted here are the ones the API receives.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('@/api/client', () => ({ apiFetch: apiFetchMock }))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { ActivityFilters } from './index'
import { activityDateOffset, type ActivityQuery } from '../../../../redux/activities'
import type { ServicesFilter } from '@/api/queries/services-filters'

const BOARD: ActivityQuery = {
  filters: {
    date_range: [activityDateOffset(0), activityDateOffset(7)],
    activity_type: [{ label: 'PK', value: 'PK' }],
    short_haul: [],
    operations_id: [],
    office: [{ label: '03 — NW of New Jersey', value: '03' }],
  },
  sortBy: { value: 'order_num', order: 'asc' },
}

const SAVED: ServicesFilter = {
  id: 'f1',
  name: 'Deliveries, Ann',
  query: {
    v: 1,
    dateFromOffsetDays: -2,
    dateToOffsetDays: 3,
    activityTypes: ['DL'],
    shortHaul: [],
    dispatchers: ['1196'],
    sortBy: null,
  },
  isPublic: true,
  isDefault: false,
  owner: { id: 'u2', email: 'ann@x.test' },
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
}

const COMMON = {
  dispatcherList: [{ code: '1196', first_name: 'Ann', last_name: 'Bee' }],
  filterOptions: { moveType: [], activityType: [{ label: 'DL', value: 'DL' }] },
} as any

describe('ActivityFilters — saved filters', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('saves the board query as offsets and values', async () => {
    apiFetchMock.mockResolvedValue({ ...SAVED, id: 'new' })
    renderWithStore(<ActivityFilters />, { activities: { query: BOARD }, common: COMMON })

    fireEvent.click(screen.getByTestId('save-services-filter'))
    fireEvent.change(screen.getByTestId('services-filter-name'), { target: { value: 'My week' } })
    fireEvent.click(screen.getByTestId('services-filter-default'))
    fireEvent.click(screen.getByTestId('services-filter-save-submit'))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled())
    const [url, init] = apiFetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/services-filters')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      name: 'My week',
      isDefault: true,
      isPublic: false,
      query: {
        v: 1,
        dateFromOffsetDays: 0,
        dateToOffsetDays: 7,
        activityTypes: ['PK'],
        shortHaul: [],
        dispatchers: [],
        offices: ['03'],
        sortBy: { value: 'order_num', order: 'asc' },
      },
    })
    await waitFor(() =>
      expect(screen.queryByTestId('save-services-filter-dialog')).not.toBeInTheDocument(),
    )
  })

  it('loads a public filter onto the board, re-anchored on today', async () => {
    apiFetchMock.mockImplementation(async (url: string) =>
      url.endsWith('scope=public') ? [SAVED] : [],
    )
    const { store } = renderWithStore(<ActivityFilters />, {
      activities: { query: BOARD },
      common: COMMON,
    })

    fireEvent.click(screen.getByTestId('open-services-filters'))
    const dialog = await screen.findByTestId('services-filters-dialog')
    // Radix Tabs switch on mousedown, not click.
    fireEvent.mouseDown(within(dialog).getByTestId('services-filters-tab-public'))
    fireEvent.click(await within(dialog).findByText('Deliveries, Ann'))
    fireEvent.click(within(dialog).getByTestId('services-filter-load'))

    expect(store.getState().activities.query).toEqual({
      filters: {
        date_range: [activityDateOffset(-2), activityDateOffset(3)],
        activity_type: [{ label: 'DL', value: 'DL' }],
        short_haul: [],
        operations_id: [{ label: 'Ann Bee', value: '1196' }],
        office: [],
      },
      sortBy: null,
    })
    // Public filters belong to someone else: no Delete on that tab.
    expect(screen.queryByTestId('services-filter-delete')).not.toBeInTheDocument()
  })

  // salesman.code is an INT in the legacy schema, so the real dispatcher list
  // carries numeric codes. Picking one used to crash the board (`.trim()` on a
  // number), and saving one would have failed the API's string schema.
  it('picks and saves a dispatcher whose code is numeric', async () => {
    apiFetchMock.mockResolvedValue({ ...SAVED, id: 'new' })
    renderWithStore(<ActivityFilters />, {
      activities: { query: BOARD },
      common: { ...COMMON, dispatcherList: [{ code: 1196, first_name: 'Ann', last_name: 'Bee' }] },
    })

    const control = screen.getByTestId('activities-filter-dispatcher')
    fireEvent.keyDown(within(control).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(await within(control).findByText('Ann Bee'))
    expect(within(control).getByText('Ann Bee')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('save-services-filter'))
    fireEvent.change(screen.getByTestId('services-filter-name'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByTestId('services-filter-save-submit'))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled())
    expect(JSON.parse(apiFetchMock.mock.calls[0]![1].body).query.dispatchers).toEqual(['1196'])
  })

  it('relabels a code-only dispatcher once the dispatcher list is there', () => {
    renderWithStore(<ActivityFilters />, {
      activities: {
        query: {
          ...BOARD,
          filters: { ...BOARD.filters, operations_id: [{ label: '1196', value: '1196' }] },
        },
      },
      common: COMMON,
    })

    expect(
      within(screen.getByTestId('activities-filter-dispatcher')).getByText('Ann Bee'),
    ).toBeInTheDocument()
  })
})

describe('ActivityFilters — local jobs toggle', () => {
  it('turns local dispatch jobs on and off without touching the saved-filter query', () => {
    const { store } = renderWithStore(<ActivityFilters />, {
      activities: { query: BOARD },
      common: COMMON,
    })
    const box = screen.getByTestId('activities-include-local') as HTMLInputElement
    expect(box.checked).toBe(false)

    fireEvent.click(box)
    expect(store.getState().activities.includeLocal).toBe(true)
    expect(store.getState().activities.query).toEqual(BOARD)

    fireEvent.click(box)
    expect(store.getState().activities.includeLocal).toBe(false)
  })
})
