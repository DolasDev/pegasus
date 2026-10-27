import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { ApiError } from '@pegasus/api-http'
import ItineraryScreen from '../../../app/(drawer)/itinerary'
import type { ItineraryItem } from '../../../src/types/itinerary'

const mockGet = jest.fn()
jest.mock('../../../src/services/itineraryService', () => ({
  ItineraryService: { getMyItinerary: (...args: unknown[]) => mockGet(...args) },
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

const HOME = { street: '1 Elm St', unit: null, city: 'Austin', state: 'TX', zip: '78701' }

function item(partial: Partial<ItineraryItem>): ItineraryItem {
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
    place: HOME,
    placeNote: null,
    day: '2026-10-27',
    plannedStart: '2026-10-27',
    plannedEnd: null,
    estimated: null,
    actual: null,
    arrivalWindow: null,
    committed: false,
    confirmed: false,
    sequence: 1,
    tripId: null,
    tripStatus: null,
    drivers: { longhaul: [], local: [] },
    ...partial,
  }
}

function ok(items: ItineraryItem[], failedSources: string[] = []) {
  return { items, meta: { count: items.length, from: 'x', to: 'y', failedSources } }
}

beforeEach(() => {
  mockGet.mockReset()
  mockPush.mockReset()
  jest.useFakeTimers({ now: new Date(2026, 9, 27, 9, 0), doNotFake: ['nextTick', 'setImmediate'] })
})
afterEach(() => jest.useRealTimers())

describe('ItineraryScreen', () => {
  it('asks for a week from today and lists acts under their stop', async () => {
    mockGet.mockResolvedValue(
      ok([
        item({ key: 'a', actName: 'Pack', tripId: 55, tripStatus: 'Accepted' }),
        item({
          key: 'b',
          actName: 'Load',
          source: { kind: 'local-job-token', jobId: 9, token: 'LOAD' },
        }),
      ]),
    )
    const { findByText, getByText } = render(<ItineraryScreen />)

    expect(await findByText('Pack')).toBeTruthy()
    expect(mockGet).toHaveBeenCalledWith('2026-10-27', '2026-11-02')
    expect(getByText('Tue Oct 27 · Today')).toBeTruthy()
    expect(getByText('1 Elm St')).toBeTruthy()
    expect(getByText('Load')).toBeTruthy()
    expect(getByText('Local')).toBeTruthy()
    expect(getByText('Trip 55')).toBeTruthy()
  })

  it('opens the shipment for a trip act, the trip from its chip, and a local job in place', async () => {
    mockGet.mockResolvedValue(
      ok([
        item({ key: 'a', actName: 'Pack', orderNum: 100, tripId: 55 }),
        item({
          key: 'b',
          actName: 'Load',
          orderNum: 200,
          source: { kind: 'local-job-token', jobId: 9, token: 'LOAD' },
          placeNote: 'Gate code 1234',
        }),
      ]),
    )
    const { findByText, getByText } = render(<ItineraryScreen />)

    fireEvent.press(await findByText('Pack'))
    expect(mockPush).toHaveBeenCalledWith('/shipment/100')

    fireEvent.press(getByText('Trip 55'))
    expect(mockPush).toHaveBeenCalledWith('/trip/55')

    fireEvent.press(getByText('Load'))
    expect(mockPush).toHaveBeenCalledTimes(2) // never the shipment screen for a local job
    expect(getByText('Local job')).toBeTruthy()
    expect(getByText('Gate code 1234')).toBeTruthy()
  })

  it('pages to the next week', async () => {
    mockGet.mockResolvedValue(ok([]))
    const { findByText, getByLabelText } = render(<ItineraryScreen />)
    await findByText('Nothing scheduled')

    fireEvent.press(getByLabelText('Next week'))

    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('2026-11-03', '2026-11-09'))
  })

  it('never lands a superseded week under the page now shown', async () => {
    let resolveStale: (v: unknown) => void = () => {}
    mockGet.mockResolvedValueOnce(ok([]))
    const { findByText, getByLabelText, queryByText } = render(<ItineraryScreen />)
    await findByText('Nothing scheduled')

    // Retry-style reload of this week hangs; the driver pages on meanwhile.
    mockGet.mockReturnValueOnce(new Promise((r) => (resolveStale = r)))
    fireEvent.press(getByLabelText('Next week'))
    mockGet.mockResolvedValueOnce(ok([item({ key: 'n', actName: 'Next week act' })]))
    fireEvent.press(getByLabelText('Next week'))
    expect(await findByText('Next week act')).toBeTruthy()

    resolveStale(ok([item({ key: 's', actName: 'Stale act' })]))
    await waitFor(() => expect(queryByText('Stale act')).toBeNull())
    expect(queryByText('Next week act')).toBeTruthy()
  })

  it('shows the onboarding state on DRIVER_NOT_MAPPED, not an error', async () => {
    mockGet.mockRejectedValue(new ApiError('not mapped', 'DRIVER_NOT_MAPPED', 403))
    const { findByText, queryByText } = render(<ItineraryScreen />)

    expect(await findByText('No driver linked')).toBeTruthy()
    expect(queryByText('Couldn’t load your itinerary')).toBeNull()
  })

  it('shows an error with Retry on any other failure', async () => {
    mockGet.mockRejectedValueOnce(new ApiError('legacy down', 'LEGACY_UNAVAILABLE', 503))
    mockGet.mockResolvedValueOnce(ok([item({ key: 'a', actName: 'Pack' })]))
    const { findByText, getByText } = render(<ItineraryScreen />)

    expect(await findByText('Couldn’t load your itinerary')).toBeTruthy()
    fireEvent.press(getByText('Retry'))
    expect(await findByText('Pack')).toBeTruthy()
  })

  it('warns when one source failed and the list is partial', async () => {
    mockGet.mockResolvedValue(ok([item({ key: 'a' })], ['local']))
    const { findByText } = render(<ItineraryScreen />)

    expect(await findByText(/Couldn’t load your local jobs/)).toBeTruthy()
  })
})
