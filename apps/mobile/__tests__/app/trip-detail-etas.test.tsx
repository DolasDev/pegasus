import React from 'react'
import { Alert } from 'react-native'
import { render, fireEvent, waitFor, act } from '@testing-library/react-native'
import TripDetailScreen from '../../app/trip/[id]'
import { TripService } from '../../src/services/tripService'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '100' }),
  useRouter: () => ({ push: jest.fn() }),
  Stack: { Screen: () => null },
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('../../src/services/tripService', () => ({
  TripService: { getTrip: jest.fn(), updateActivityEta: jest.fn() },
}))
jest.mock('../../src/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }))

const getTripMock = TripService.getTrip as jest.Mock
const updateMock = TripService.updateActivityEta as jest.Mock

const trip = {
  id: 100,
  trip_title: null,
  driver_id: 42,
  driver_name: 'Pat Driver',
  status_status: 'Accepted',
  TripStatus_id: 3,
  internal_status: null,
  origin_geo_code: 'TX',
  destination_geo_code: 'CA',
  planned_first_day: null,
  planned_last_day: null,
  actual_first_day: null,
  actual_last_day: null,
  total_estimated_lbs: null,
  total_actual_lbs: null,
  total_estimated_linehaul_usd: null,
  total_days: null,
  shipments: [{ order_num: 1234, shipper_name: 'Jane Shipper' }],
  activities: [
    { id: 1, order_num: 1234, ActivityType_code: 'PACK' },
    { id: 2, order_num: 1234, ActivityType_code: 'SITOUT', activityType_abbreviation: 'SIT' },
    {
      id: 3,
      order_num: 1234,
      ActivityType_code: 'RDEL',
      activityType_isHasETA: true,
      estimated_date: '2026-11-02T00:00:00.000Z',
      is_committed: false,
    },
    {
      id: 4,
      order_num: 1234,
      ActivityType_code: 'SITIN',
      activityType_isHasETA: true,
      is_committed: 1,
    },
  ],
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  getTripMock.mockResolvedValue(trip)
})

describe('Trip detail — delivery ETAs', () => {
  it('lists only Delivery and SIT-IN activities, with their commitment state', async () => {
    const { findByText, getByText, getAllByText, queryByText } = render(<TripDetailScreen />)
    expect(await findByText('DELIVERY ETAS (2)')).toBeTruthy()
    expect(getByText('Delivery · #1234')).toBeTruthy()
    expect(getByText('Delivery to Storage (SIT-IN) · #1234')).toBeTruthy()
    expect(getByText('NOT CONFIRMED')).toBeTruthy()
    expect(getByText('✓ CONFIRMED WITH SHIPPER')).toBeTruthy()
    expect(getByText('You and the shipper have committed to this date.')).toBeTruthy()
    expect(getAllByText('Jane Shipper').length).toBeGreaterThan(0)
    expect(queryByText(/SIT-OUT/)).toBeNull()
  })

  it('a delivered activity is read-only — no editor opens', async () => {
    getTripMock.mockResolvedValue({
      ...trip,
      activities: trip.activities.map((a) =>
        a.id === 3 ? { ...a, actual_date: '2026-11-02T00:00:00.000Z' } : a,
      ),
    })
    const { findByLabelText, getByText, queryByLabelText } = render(<TripDetailScreen />)
    const card = await findByLabelText('Delivery #1234, delivered')
    expect(getByText(/Delivered Mon, Nov 2, 2026 — ask dispatch/)).toBeTruthy()
    expect(queryByLabelText('Set ETA for Delivery #1234')).toBeNull()
    fireEvent.press(card)
    expect(queryByLabelText('Mark as Confirmed')).toBeNull()
  })

  it('confirming an ETA updates its badge in place', async () => {
    updateMock.mockResolvedValue({ id: 3, is_committed: true })
    const { findByLabelText, getByLabelText, getByText, getAllByText } = render(
      <TripDetailScreen />,
    )
    fireEvent.press(await findByLabelText('Set ETA for Delivery #1234'))
    fireEvent(getByLabelText('Mark as Confirmed'), 'valueChange', true)
    fireEvent.press(getByText('Save'))
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string
      onPress?: () => void
    }>
    await act(async () => buttons.find((b) => b.text === 'Confirm')!.onPress!())
    await waitFor(() => expect(getAllByText('✓ CONFIRMED WITH SHIPPER')).toHaveLength(2))
    expect(updateMock).toHaveBeenCalledWith(3, expect.objectContaining({ committed: true }))
  })
})
