import React from 'react'
import { render, waitFor, fireEvent } from '@testing-library/react-native'
import DashboardScreen from '../../../app/(drawer)/index'
import { getDriverMetrics } from '../../services/driverMetrics'

jest.mock('../../services/driverMetrics')
jest.mock('../../utils/logger')
jest.mock('../../context/TripsContext', () => ({
  useTrips: () => ({ offeredCount: 0, refresh: jest.fn() }),
}))

const mockMetrics = {
  driverId: 4766,
  asOf: '2026-10-15T12:00:00Z',
  weekStart: '2026-10-12T05:00:00Z',
  trips: { activeShipments: 4, completedThisWeek: 6 },
  financials: {
    runningBalance: 1234.56,
    escrowHeld: 800,
    monthEnd: { year: 2026, month: 9, balance: 1100 },
    pendingSettlement: { total: 500, count: 2 },
  },
  unavailable: [],
}

const ok = (metrics: unknown) => ({ status: 'ok', metrics })
const mock = getDriverMetrics as jest.Mock

describe('Driver Dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mock.mockResolvedValue(ok(mockMetrics))
  })

  it('renders metric tiles after loading', async () => {
    const { getByText, queryByText } = render(<DashboardScreen />)

    await waitFor(() => {
      expect(getByText('Account Balance')).toBeTruthy()
    })

    expect(getByText('$1,234.56')).toBeTruthy()
    expect(getByText('Escrow held $800.00')).toBeTruthy()
    expect(getByText('Month-end Sep 2026 $1,100.00')).toBeTruthy()
    expect(getByText('Active Shipments')).toBeTruthy()
    expect(getByText('4')).toBeTruthy()
    expect(getByText('Pending Settlement')).toBeTruthy()
    expect(getByText('$500.00')).toBeTruthy()
    expect(getByText('2 awaiting payout')).toBeTruthy()
    expect(getByText('Completed (wk)')).toBeTruthy()
    expect(getByText('6')).toBeTruthy()
    expect(queryByText('Miles (wk)')).toBeNull()
  })

  it('renders dashes and Unavailable when financials is null', async () => {
    mock.mockResolvedValue(ok({ ...mockMetrics, financials: null }))
    const { getByText, getAllByText } = render(<DashboardScreen />)

    await waitFor(() => expect(getByText('Account Balance')).toBeTruthy())
    expect(getAllByText('—')).toHaveLength(2)
    expect(getAllByText('Unavailable')).toHaveLength(2)
    expect(getByText('4')).toBeTruthy()
  })

  it('renders dashes when trips is null and omits null balance parts', async () => {
    mock.mockResolvedValue(
      ok({
        ...mockMetrics,
        trips: null,
        financials: { ...mockMetrics.financials, escrowHeld: null, monthEnd: null },
      }),
    )
    const { getByText, getAllByText, queryByText } = render(<DashboardScreen />)

    await waitFor(() => expect(getByText('Account Balance')).toBeTruthy())
    expect(getAllByText('—')).toHaveLength(2)
    expect(getAllByText('Unavailable')).toHaveLength(2)
    expect(getByText('$1,234.56')).toBeTruthy()
    expect(queryByText(/Escrow held/)).toBeNull()
    expect(queryByText(/Month-end/)).toBeNull()
  })

  it('shows a null running balance as a dash while keeping other lines', async () => {
    mock.mockResolvedValue(
      ok({ ...mockMetrics, financials: { ...mockMetrics.financials, runningBalance: null } }),
    )
    const { getByText, getAllByText } = render(<DashboardScreen />)

    await waitFor(() => expect(getByText('Account Balance')).toBeTruthy())
    expect(getAllByText('—')).toHaveLength(1)
    expect(getByText('Escrow held $800.00')).toBeTruthy()
  })

  it('shows an error with Retry, and retry reloads', async () => {
    mock.mockRejectedValueOnce(new Error('boom'))
    const { getByText, queryByText } = render(<DashboardScreen />)

    await waitFor(() => expect(getByText("We couldn't load your dashboard.")).toBeTruthy())
    expect(queryByText('Loading dashboard…')).toBeNull()

    fireEvent.press(getByText('Retry'))
    await waitFor(() => expect(getByText('Account Balance')).toBeTruthy())
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('shows the not-linked message', async () => {
    mock.mockResolvedValue({ status: 'not_linked' })
    const { getByText } = render(<DashboardScreen />)

    await waitFor(() =>
      expect(
        getByText("Your account isn't linked to a driver yet — ask your dispatcher."),
      ).toBeTruthy(),
    )
  })

  it('shows loading state initially', () => {
    // A promise that never settles is all this assertion needs: the screen stays in
    // its loading branch and nothing is left behind. The previous mock resolved via
    // `setTimeout(…, 1000)`, and because the test asserts synchronously and returns,
    // that real timer outlived it — `jest --detectOpenHandles` named it as the ONE
    // open handle in the whole apps/mobile suite, reproducibly. `jest --forceExit`
    // (the package's `test` script) then killed the worker instead of failing, which
    // is the "A worker process has failed to exit gracefully" line CI reported on
    // 2026-10-01. Never resolve a loading-state mock on a real timer.
    mock.mockImplementation(() => new Promise<never>(() => {}))

    const { getByText } = render(<DashboardScreen />)
    expect(getByText('Loading dashboard…')).toBeTruthy()
  })
})
