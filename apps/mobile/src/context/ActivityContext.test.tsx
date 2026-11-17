import React from 'react'
import { AppState, Text } from 'react-native'
import { act, render, waitFor } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import { ActivityProvider, useActivity } from './ActivityContext'

const mockCount = jest.fn()
const mockSeen = jest.fn()
jest.mock('../services/activityService', () => ({
  ActivityService: {
    unseenCount: () => mockCount(),
    markSeen: () => mockSeen(),
  },
}))

function Probe() {
  const { unseen, markSeen } = useActivity()
  return (
    <Text testID="unseen" onPress={() => void markSeen()}>
      {unseen}
    </Text>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSeen.mockResolvedValue(undefined)
})

describe('ActivityProvider', () => {
  it('loads the count, and refreshes on foreground and on a received push', async () => {
    let appListener: ((s: string) => void) | undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
      appListener = cb as (s: string) => void
      return { remove: jest.fn() } as never
    })
    mockCount.mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(5)
    const { getByTestId } = render(
      <ActivityProvider>
        <Probe />
      </ActivityProvider>,
    )
    await waitFor(() => expect(getByTestId('unseen').props.children).toBe(2))

    await act(async () => appListener?.('active'))
    await waitFor(() => expect(getByTestId('unseen').props.children).toBe(3))

    const received = (Notifications.addNotificationReceivedListener as jest.Mock).mock.calls.at(
      -1,
    )?.[0]
    await act(async () => received?.({}))
    await waitFor(() => expect(getByTestId('unseen').props.children).toBe(5))
  })

  it('clears the count on markSeen', async () => {
    mockCount.mockResolvedValue(4)
    const { getByTestId } = render(
      <ActivityProvider>
        <Probe />
      </ActivityProvider>,
    )
    await waitFor(() => expect(getByTestId('unseen').props.children).toBe(4))
    await act(async () => getByTestId('unseen').props.onPress())
    expect(getByTestId('unseen').props.children).toBe(0)
    expect(mockSeen).toHaveBeenCalled()
  })

  it('is an empty bell outside a provider', () => {
    expect(render(<Probe />).getByTestId('unseen').props.children).toBe(0)
  })
})
