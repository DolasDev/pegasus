// ---------------------------------------------------------------------------
// ActivitiesModule (Services) test: composition, same shape as
// PlanningModule.test.tsx. Children are mocked. This pins that:
//   - the board and the shipment detail panel are both mounted;
//   - the board waits for the user's saved default filter and seeds it once.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('@/api/client', () => ({ apiFetch: apiFetchMock }))

vi.mock('../containers/Activities', () => ({
  ActivitiesDashboard: () => <div data-testid="mock-activities-dashboard" />,
}))
vi.mock('../containers/ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="mock-shipment-detail" />,
}))

import { renderWithStore } from '../__test-utils__/render-with-store'
import { ActivitiesModule } from './ActivitiesModule'
import { DEFAULT_ACTIVITY_QUERY, activityDateOffset } from '../redux/activities'
import type { ServicesFilter } from '@/api/queries/services-filters'

const SAVED_DEFAULT: ServicesFilter = {
  id: 'f1',
  name: 'Next fortnight, packs',
  query: {
    v: 1,
    dateFromOffsetDays: 1,
    dateToOffsetDays: 14,
    activityTypes: ['PK'],
    shortHaul: ['N'],
    dispatchers: ['1196'],
    sortBy: { value: 'order_num', order: 'desc' },
  },
  isPublic: false,
  isDefault: true,
  owner: { id: 'u1', email: 'me@x.test' },
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
}

describe('ActivitiesModule', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    apiFetchMock.mockResolvedValue(null)
  })

  it('mounts the board alongside the shipment detail panel', async () => {
    renderWithStore(<ActivitiesModule />)

    expect(await screen.findByTestId('mock-activities-dashboard')).toBeInTheDocument()
    // Selecting a service card sets `shipments.selectedShipment`, which this
    // panel reads, the same as a shipment card on Planning.
    expect(screen.getByTestId('mock-shipment-detail')).toBeInTheDocument()
  })

  it('holds the board until the default resolves, then opens on the saved filter', async () => {
    let resolve!: (v: ServicesFilter) => void
    apiFetchMock.mockReturnValue(new Promise((r) => (resolve = r)))
    const { store } = renderWithStore(<ActivitiesModule />, {
      common: {
        dispatcherList: [{ code: '1196', first_name: 'Ann', last_name: 'Bee' }],
      } as any,
    })

    // Mounting now would fetch the built-in week, then re-fetch the saved range.
    expect(screen.queryByTestId('mock-activities-dashboard')).not.toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/services-filters/default')

    resolve(SAVED_DEFAULT)

    expect(await screen.findByTestId('mock-activities-dashboard')).toBeInTheDocument()
    expect(store.getState().activities.query).toEqual({
      filters: {
        date_range: [activityDateOffset(1), activityDateOffset(14)],
        activity_type: [{ label: 'PK', value: 'PK' }],
        short_haul: [{ label: 'No', value: 'N' }],
        operations_id: [{ label: 'Ann Bee', value: '1196' }],
        office: [],
      },
      sortBy: { value: 'order_num', order: 'desc' },
    })
  })

  it('falls back to the built-in query when the default cannot be read', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'))
    const { store } = renderWithStore(<ActivitiesModule />)

    expect(await screen.findByTestId('mock-activities-dashboard')).toBeInTheDocument()
    expect(store.getState().activities.query).toEqual(DEFAULT_ACTIVITY_QUERY)
  })

  it('applies the default once: a return visit keeps the current filters', async () => {
    const current = {
      ...DEFAULT_ACTIVITY_QUERY,
      filters: { ...DEFAULT_ACTIVITY_QUERY.filters, short_haul: [{ label: 'Yes', value: 'Y' }] },
    }
    apiFetchMock.mockResolvedValue(SAVED_DEFAULT)
    const { store } = renderWithStore(<ActivitiesModule />, {
      activities: { query: current, defaultSeeded: true } as any,
    })

    expect(screen.getByTestId('mock-activities-dashboard')).toBeInTheDocument()
    await waitFor(() => expect(store.getState().activities.query).toEqual(current))
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('closes the drawer on the way out, so a trip link does not land with it open', () => {
    // The Trip page mounts the same drawer off the same global selection.
    const { store, unmount } = renderWithStore(<ActivitiesModule />, {
      shipments: { selectedShipment: { order_num: 5001 } as any },
    })

    unmount()

    expect(store.getState().shipments.selectedShipment).toBeNull()
  })
})
