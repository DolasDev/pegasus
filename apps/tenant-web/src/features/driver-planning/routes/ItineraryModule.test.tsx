// ---------------------------------------------------------------------------
// ItineraryModule (Operations → Itinerary) test: the two separate pickers, the
// week range, the grouped list, opening an act's order in the shared drawer,
// and the partial-list warning.
//
// `@/api/client` is mocked by URL; queries run for real. The drawer and the
// selectShipment thunk are mocked — selecting is asserted, not fetched.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItineraryItem } from '@/api/queries/driver-itinerary'

const { apiFetchMock, paginatedMock, selectShipmentMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  paginatedMock: vi.fn(),
  selectShipmentMock: vi.fn((row: unknown) => ({ type: 'test/selectShipment', payload: row })),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: apiFetchMock, apiFetchPaginated: paginatedMock }
})
vi.mock('../containers/ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="mock-shipment-detail" />,
}))
vi.mock('../redux/shipments', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../redux/shipments')
  return { ...actual, selectShipment: selectShipmentMock }
})

import { renderWithStore } from '../__test-utils__/render-with-store'
import { ItineraryModule } from './ItineraryModule'

function item(over: Partial<ItineraryItem>): ItineraryItem {
  return {
    key: 'k',
    source: { kind: 'longhaul-activity', activityId: 1 },
    orderNum: 100,
    shipperName: 'Smith',
    actCode: 'PACK',
    actName: 'Pack',
    known: true,
    kind: 'act',
    side: 'origin',
    place: { street: '1 Elm St', unit: null, city: 'Austin', state: 'TX', zip: '78701' },
    placeNote: null,
    day: '2026-11-02',
    plannedStart: '2026-11-02',
    plannedEnd: null,
    estimated: null,
    actual: null,
    arrivalWindow: null,
    committed: false,
    confirmed: false,
    sequence: 1,
    tripId: 55,
    tripStatus: 'Accepted',
    drivers: { longhaul: [134], local: [] },
    assertion: null,
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), toFake: ['Date'] })
  apiFetchMock.mockReset()
  paginatedMock.mockReset()
  selectShipmentMock.mockClear()
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/v1/onprem/longhaul/drivers')
      return [
        { driver_id: 0, driver_name: 'Unassigned', agent_code: null, active: 'Y', type: null },
        {
          driver_id: 134,
          driver_name: 'Sherwood, Benjamin',
          agent_code: null,
          active: 'Y',
          type: null,
        },
      ]
    if (path === '/api/v1/onprem/longhaul/local-drivers')
      return [{ employeeId: 3097, name: 'Snyder, Norm' }]
    throw new Error(`unexpected ${path}`)
  })
  paginatedMock.mockResolvedValue({
    data: [
      item({ key: 'a', actName: 'Pack' }),
      item({
        key: 'b',
        actName: 'Del',
        orderNum: 300,
        tripId: null,
        tripStatus: null,
        source: { kind: 'order-assigned', orderNum: 300, actCode: 'RDEL' },
        place: { street: '9 Oak Ave', unit: null, city: 'Waco', state: 'TX', zip: null },
        arrivalWindow: { start: '08:00', end: '08:00', tz: null },
        assertion: { eta: null, done: '2026-11-02', assertedAt: 'x', byUserId: 'u1' },
      }),
    ],
    meta: { count: 2, failedSources: [] },
  })
})

afterEach(() => vi.useRealTimers())

describe('ItineraryModule', () => {
  it('asks the dispatcher to pick before reading anything', async () => {
    renderWithStore(<ItineraryModule />)
    expect(await screen.findByText('Pick a driver')).toBeInTheDocument()
    expect(paginatedMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('mock-shipment-detail')).toBeInTheDocument()
  })

  it('reads the picked longhaul driver for this week and groups by stop', async () => {
    const user = userEvent.setup()
    renderWithStore(<ItineraryModule />)
    const picker = await screen.findByLabelText('Longhaul driver')
    await waitFor(() => expect(picker).not.toBeDisabled())
    // The legacy "unassigned" driver 0 is never offered.
    expect(screen.queryByRole('option', { name: 'Unassigned' })).toBeNull()

    await user.selectOptions(picker, '134')

    await waitFor(() =>
      expect(paginatedMock).toHaveBeenCalledWith(
        '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-02&to=2026-11-08&longhaulDriverId=134',
      ),
    )
    expect(await screen.findByText('Mon Nov 2 · Today')).toBeInTheDocument()
    expect(screen.getByText('1 Elm St')).toBeInTheDocument()
    expect(screen.getByText('9 Oak Ave')).toBeInTheDocument()
    expect(screen.getByText('Trip 55')).toBeInTheDocument()
    expect(screen.getByText('Order')).toBeInTheDocument()
    expect(screen.getByText(/Arrive 08:00$/)).toBeInTheDocument()
    // The driver's own word from the app, beside the legacy values.
    expect(screen.getByText('Driver: done Mon Nov 2')).toBeInTheDocument()
  })

  it('sends a crew in its own parameter, and both when both are picked', async () => {
    const user = userEvent.setup()
    renderWithStore(<ItineraryModule />)
    const crew = await screen.findByLabelText('Local crew')
    await waitFor(() => expect(crew).not.toBeDisabled())

    await user.selectOptions(crew, '3097')
    await waitFor(() =>
      expect(paginatedMock).toHaveBeenLastCalledWith(
        '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-02&to=2026-11-08&localDriverEmployeeId=3097',
      ),
    )

    await user.selectOptions(screen.getByLabelText('Longhaul driver'), '134')
    await waitFor(() =>
      expect(paginatedMock).toHaveBeenLastCalledWith(
        '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-02&to=2026-11-08&longhaulDriverId=134&localDriverEmployeeId=3097',
      ),
    )
  })

  it("opens an act's order in the shared drawer and pages by week", async () => {
    const user = userEvent.setup()
    renderWithStore(<ItineraryModule />)
    const picker = await screen.findByLabelText('Longhaul driver')
    await waitFor(() => expect(picker).not.toBeDisabled())
    await user.selectOptions(picker, '134')

    await user.click(await screen.findByText('Del'))
    expect(selectShipmentMock).toHaveBeenLastCalledWith({ order_num: 300 })

    await user.click(screen.getByLabelText('Next week'))
    await waitFor(() =>
      expect(paginatedMock).toHaveBeenLastCalledWith(
        '/api/v1/onprem/longhaul/drivers/itinerary?from=2026-11-09&to=2026-11-15&longhaulDriverId=134',
      ),
    )
  })

  it('warns when a source could not be read', async () => {
    paginatedMock.mockResolvedValue({ data: [item({})], meta: { failedSources: ['local'] } })
    const user = userEvent.setup()
    renderWithStore(<ItineraryModule />)
    const picker = await screen.findByLabelText('Longhaul driver')
    await waitFor(() => expect(picker).not.toBeDisabled())
    await user.selectOptions(picker, '134')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load local jobs')
  })

  describe('phone notifications status', () => {
    const PHONE = '/api/v1/onprem/longhaul/drivers/phone-status?longhaulDriverId=134'

    function withPhoneStatus(data: unknown) {
      const base = apiFetchMock.getMockImplementation()!
      apiFetchMock.mockImplementation(async (path: string) => (path === PHONE ? data : base(path)))
    }

    async function pickDriver() {
      const user = userEvent.setup()
      renderWithStore(<ItineraryModule />)
      const picker = await screen.findByLabelText('Longhaul driver')
      await waitFor(() => expect(picker).not.toBeDisabled())
      await user.selectOptions(picker, '134')
    }

    it('reads nothing until a driver is picked', async () => {
      renderWithStore(<ItineraryModule />)
      await screen.findByText('Pick a driver')
      expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('phone-status'))
    })

    it('warns the dispatcher when the driver has notifications off, with how to fix it', async () => {
      withPhoneStatus({
        longhaul: {
          status: 'off',
          lastSeenAt: '2026-11-01T15:00:00Z',
          devices: [
            { platform: 'ANDROID', permission: 'blocked', lastSeenAt: '2026-11-01T15:00:00Z' },
          ],
        },
        local: null,
      })
      await pickDriver()
      expect(await screen.findByText('Notifications off')).toBeInTheDocument()
      expect(screen.getByText(/Settings → Permissions → Notifications/)).toBeInTheDocument()
      expect(screen.getByText(/as of the app’s last open/)).toBeInTheDocument()
    })

    it('shows notifications on', async () => {
      withPhoneStatus({
        longhaul: {
          status: 'on',
          lastSeenAt: '2026-11-01T15:00:00Z',
          devices: [{ platform: 'IOS', permission: 'granted', lastSeenAt: '2026-11-01T15:00:00Z' }],
        },
        local: null,
      })
      await pickDriver()
      expect(await screen.findByText('Notifications on')).toBeInTheDocument()
      expect(screen.getByText('Longhaul driver:')).toBeInTheDocument()
    })

    it('says when no login is mapped to the driver', async () => {
      withPhoneStatus({
        longhaul: { status: 'notLinked', lastSeenAt: null, devices: [] },
        local: null,
      })
      await pickDriver()
      expect(await screen.findByText('No login linked')).toBeInTheDocument()
      expect(screen.queryByText(/as of the app’s last open/)).toBeNull()
    })

    it('shows the longhaul driver and the local crew separately, never merged', async () => {
      const BOTH =
        '/api/v1/onprem/longhaul/drivers/phone-status?longhaulDriverId=134&localDriverEmployeeId=3097'
      const base = apiFetchMock.getMockImplementation()!
      apiFetchMock.mockImplementation(async (path: string) =>
        path === BOTH
          ? {
              longhaul: { status: 'on', lastSeenAt: '2026-11-01T15:00:00Z', devices: [] },
              local: { status: 'off', lastSeenAt: '2026-11-01T15:00:00Z', devices: [] },
            }
          : base(path),
      )
      const user = userEvent.setup()
      renderWithStore(<ItineraryModule />)
      const lh = await screen.findByLabelText('Longhaul driver')
      const crew = screen.getByLabelText('Local crew')
      await waitFor(() => expect(crew).not.toBeDisabled())
      await user.selectOptions(lh, '134')
      await user.selectOptions(crew, '3097')

      expect(await screen.findByText('Local crew:')).toBeInTheDocument()
      expect(screen.getByText('Longhaul driver:')).toBeInTheDocument()
      expect(screen.getByText('Notifications on')).toBeInTheDocument()
      expect(screen.getByText('Notifications off')).toBeInTheDocument()
    })

    it('says nothing when the status cannot be read', async () => {
      // The default mock throws for the phone-status path.
      await pickDriver()
      await screen.findByText('Pack')
      expect(screen.queryByText(/Notifications/)).toBeNull()
    })
  })
})
