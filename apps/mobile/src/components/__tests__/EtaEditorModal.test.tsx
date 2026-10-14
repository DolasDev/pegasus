import React from 'react'
import { Alert } from 'react-native'
import { render, fireEvent, waitFor, act } from '@testing-library/react-native'
import { EtaEditorModal } from '../EtaEditorModal'
import { TripService } from '../../services/tripService'
import type { LonghaulActivity } from '../../types/longhaul'

jest.mock('../../services/tripService', () => ({
  TripService: { updateActivityEta: jest.fn() },
}))
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))

const updateMock = TripService.updateActivityEta as jest.Mock

const delivery: LonghaulActivity = {
  id: 5,
  order_num: 1234,
  ActivityType_code: 'RDEL',
  activityType_isHasETA: true,
  estimated_date: '2026-11-02T00:00:00.000Z',
  planned_start: '2026-11-01T00:00:00.000Z',
  arrival_window_tz_suggested: 'America/Chicago',
  is_committed: false,
}

const confirmedDelivery: LonghaulActivity = {
  ...delivery,
  arrival_window_start: '08:00',
  arrival_window_end: '10:00',
  arrival_window_tz: 'America/Chicago',
  is_committed: true,
}

/** Run the onPress of the alert button with the given text. */
function pressAlertButton(text: string) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as Array<{
    text: string
    onPress?: () => void
  }>
  const button = buttons.find((b) => b.text === text)
  if (!button) throw new Error(`No alert button "${text}"`)
  act(() => button.onPress?.())
}

function renderModal(activity: LonghaulActivity, onSaved = jest.fn()) {
  const utils = render(
    <EtaEditorModal visible activity={activity} onClose={jest.fn()} onSaved={onSaved} />,
  )
  return { ...utils, onSaved }
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  updateMock.mockResolvedValue({ ...delivery, is_committed: true })
})

describe('EtaEditorModal', () => {
  it('always explains that Confirmed means both driver and shipper committed', () => {
    const { getByText } = renderModal(delivery)
    expect(
      getByText(/Confirmed means both you and the shipper have committed to this delivery date/),
    ).toBeTruthy()
  })

  it('saves an unconfirmed ETA without asking', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal(delivery)
    fireEvent.press(getByLabelText('Next day'))
    fireEvent.press(getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith(5, { estimated_date: '2026-11-03', committed: false })
  })

  it('asks the driver to confirm, in words, before marking Confirmed', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal(delivery)
    fireEvent(getByLabelText('Include arrival window'), 'valueChange', true)
    fireEvent(getByLabelText('Mark as Confirmed'), 'valueChange', true)
    fireEvent.press(getByText('Save'))

    expect(updateMock).not.toHaveBeenCalled()
    const [title, message] = (Alert.alert as jest.Mock).mock.calls[0]
    expect(title).toBe('Confirm with the shipper?')
    expect(message).toContain('both you and the shipper have committed to delivering')
    expect(message).toContain('on Mon, Nov 2, 2026 between 8:00 AM – 10:00 AM Central')

    pressAlertButton('Confirm')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMock).toHaveBeenCalledWith(5, {
      estimated_date: '2026-11-02',
      arrival_window_start: '08:00',
      arrival_window_end: '10:00',
      arrival_window_tz: 'America/Chicago',
      committed: true,
    })
  })

  it('does not save when the driver cancels the confirmation', () => {
    const { getByText, getByLabelText } = renderModal(delivery)
    fireEvent(getByLabelText('Mark as Confirmed'), 'valueChange', true)
    fireEvent.press(getByText('Save'))
    pressAlertButton('Cancel')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('changing a confirmed ETA asks to re-confirm — and can save it as not confirmed', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal(confirmedDelivery)
    fireEvent.press(getByLabelText('Next day'))
    fireEvent.press(getByText('Save'))

    const [title, message] = (Alert.alert as jest.Mock).mock.calls[0]
    expect(title).toBe('Re-confirm with the shipper?')
    expect(message).toContain('The shipper agreed to delivery on Mon, Nov 2, 2026')
    expect(message).toContain('on Tue, Nov 3, 2026')

    pressAlertButton('Save as not confirmed')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMock).toHaveBeenCalledWith(5, expect.objectContaining({ committed: false }))
  })

  it('re-confirming a changed ETA keeps it Confirmed', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal(confirmedDelivery)
    fireEvent.press(getByLabelText('To later'))
    fireEvent.press(getByText('Save'))
    pressAlertButton('Re-confirm with shipper')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMock).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ arrival_window_end: '10:30', committed: true }),
    )
  })

  it('saving a confirmed ETA unchanged does not re-ask', async () => {
    const { getByText, onSaved } = renderModal(confirmedDelivery)
    fireEvent.press(getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('types without an ETA date only send an arrival window', async () => {
    const windowOnly: LonghaulActivity = {
      ...delivery,
      ActivityType_code: 'SITIN',
      activityType_isHasETA: false,
      estimated_date: null,
    }
    const { getByText, queryByLabelText, onSaved } = renderModal(windowOnly)
    expect(getByText('Delivery to Storage (SIT-IN) · #1234')).toBeTruthy()
    expect(queryByLabelText('Next day')).toBeNull()
    fireEvent.press(getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const body = updateMock.mock.calls[0][1]
    expect(body).not.toHaveProperty('estimated_date')
    expect(body).toMatchObject({ arrival_window_start: '08:00', arrival_window_end: '10:00' })
  })

  it('turning the window off clears a stored one', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal({
      ...confirmedDelivery,
      is_committed: false,
    })
    fireEvent(getByLabelText('Include arrival window'), 'valueChange', false)
    fireEvent.press(getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMock).toHaveBeenCalledWith(5, {
      estimated_date: '2026-11-02',
      arrival_window_start: null,
      arrival_window_end: null,
      arrival_window_tz: null,
      committed: false,
    })
  })

  it('sends the time zone the driver picks', async () => {
    const { getByText, getByLabelText, onSaved } = renderModal(delivery)
    fireEvent(getByLabelText('Include arrival window'), 'valueChange', true)
    fireEvent.press(getByLabelText('Pacific time'))
    fireEvent.press(getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMock).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ arrival_window_tz: 'America/Los_Angeles' }),
    )
  })

  it('requires a time zone when none is stored or suggested', () => {
    const { getByText, getByLabelText } = renderModal({
      ...delivery,
      arrival_window_tz_suggested: null,
    })
    fireEvent(getByLabelText('Include arrival window'), 'valueChange', true)
    fireEvent.press(getByText('Save'))
    expect(getByText('Choose the time zone of the delivery address.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('blocks an inverted window', () => {
    const { getByText, getByLabelText } = renderModal(confirmedDelivery)
    for (let i = 0; i < 5; i++) fireEvent.press(getByLabelText('To earlier'))
    fireEvent.press(getByText('Save'))
    expect(getByText('The window must end after it starts.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('shows the server error and stays open when the save fails', async () => {
    updateMock.mockRejectedValueOnce(new Error('This activity is not assigned to you'))
    const { getByText, findByText, onSaved } = renderModal(delivery)
    fireEvent.press(getByText('Save'))
    expect(await findByText('This activity is not assigned to you')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
