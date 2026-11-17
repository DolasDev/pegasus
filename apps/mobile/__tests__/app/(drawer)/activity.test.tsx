import React from 'react'
import type * as ReactModule from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import ActivityScreen from '../../../app/(drawer)/activity'
import type { ActivityItem } from '../../../src/types/activity'

const mockList = jest.fn()
const mockRead = jest.fn()
const mockReadAll = jest.fn()
jest.mock('../../../src/services/activityService', () => ({
  ActivityService: {
    list: (...a: unknown[]) => mockList(...a),
    markRead: (...a: unknown[]) => mockRead(...a),
    markAllRead: (...a: unknown[]) => mockReadAll(...a),
  },
}))

const mockMarkSeen = jest.fn()
jest.mock('../../../src/context/ActivityContext', () => ({
  useActivity: () => ({ unseen: 2, refresh: jest.fn(), markSeen: mockMarkSeen }),
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual<typeof ReactModule>('react')
    React.useEffect(cb, [])
  },
}))

function item(over: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'n1',
    type: 'trip.assigned',
    title: 'New trip assigned',
    body: 'You have been assigned to a trip.',
    data: { type: 'trip.assigned', tripId: 77 },
    entityType: 'trip',
    entityId: '77',
    groupKey: null,
    actorName: null,
    createdAt: new Date().toISOString(),
    seenAt: null,
    readAt: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRead.mockResolvedValue(undefined)
  mockReadAll.mockResolvedValue(undefined)
  mockMarkSeen.mockResolvedValue(undefined)
})

describe('ActivityScreen', () => {
  it('clears the bell on focus and lists rows, grouping one order’s mentions', async () => {
    mockList.mockResolvedValue({
      items: [
        item({}),
        item({
          id: 'm1',
          type: 'chat.mention',
          title: 'Sam mentioned you',
          groupKey: 'order:4242',
          entityId: '4242',
          data: { type: 'chat.message', orderNum: '4242' },
        }),
        item({
          id: 'm2',
          type: 'chat.mention',
          title: 'Pat mentioned you',
          groupKey: 'order:4242',
          entityId: '4242',
          data: { type: 'chat.message', orderNum: '4242' },
        }),
      ],
      nextCursor: null,
      unseen: 3,
    })
    const { findByText, getByText } = render(<ActivityScreen />)
    expect(await findByText('New trip assigned')).toBeTruthy()
    expect(getByText('2 updates on #4242')).toBeTruthy()
    expect(mockMarkSeen).toHaveBeenCalledTimes(1)
  })

  it('opens the same screen the push would, and marks the row read', async () => {
    mockList.mockResolvedValue({ items: [item({})], nextCursor: null, unseen: 1 })
    const { findByLabelText } = render(<ActivityScreen />)
    fireEvent.press(await findByLabelText('New trip assigned'))
    expect(mockPush).toHaveBeenCalledWith('/trip/77')
    expect(mockRead).toHaveBeenCalledWith('n1')
  })

  it('marks everything read', async () => {
    mockList.mockResolvedValue({ items: [item({})], nextCursor: null, unseen: 1 })
    const { findByLabelText } = render(<ActivityScreen />)
    fireEvent.press(await findByLabelText('Mark all read'))
    await waitFor(() => expect(mockReadAll).toHaveBeenCalled())
  })

  it('says when there is nothing yet', async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null, unseen: 0 })
    const { findByText } = render(<ActivityScreen />)
    expect(await findByText('No activity yet')).toBeTruthy()
  })
})
