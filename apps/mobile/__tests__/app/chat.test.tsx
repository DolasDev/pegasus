import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import MessagesScreen from '../../app/(drawer)/messages'
import ShipmentDetailScreen from '../../app/shipment/[orderNum]'
import { ChatThreadView, buildRows } from '../../src/components/chat/ChatThreadView'
import { DrawerContent } from '../../src/components/DrawerContent'
import { ChatService, type ChatInboxEntry, type ChatMessage } from '../../src/services/chatService'
import { TripService } from '../../src/services/tripService'
import type { PendingMessage } from '../../src/chat/thread-state'

// Screen-level checks for move chat on the phone: the Messages list, the
// thread (mine on the right, mentions as names, a failed send's controls), the
// shipment's Chat tab as a push deep link lands on it, and the drawer badge.

const mockPush = jest.fn()
const mockParams = jest.fn(() => ({}) as Record<string, string>)
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams(),
  Stack: { Screen: () => null },
}))

const mockChat = jest.fn()
jest.mock('../../src/chat/ChatContext', () => ({
  useChat: () => mockChat(),
}))
jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ session: { email: 'driver@x.test' } }),
}))
jest.mock('../../src/context/TripsContext', () => ({
  useTrips: () => ({ offeredCount: 0 }),
}))
jest.mock('../../src/services/chatService', () => ({
  ChatService: {
    getMessages: jest.fn(),
    postMessage: jest.fn(),
    markRead: jest.fn(),
    deleteMessage: jest.fn(),
  },
}))
jest.mock('../../src/services/tripService', () => ({
  TripService: { getShipment: jest.fn() },
}))
jest.mock('../../src/components/DocumentsTab', () => ({ DocumentsTab: () => null }))
// The drawer package ships ESM only; stand in for the two pieces DrawerContent uses.
jest.mock('@react-navigation/drawer', () => {
  const { Pressable, View } = jest.requireActual('react-native')
  return {
    DrawerContentScrollView: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
    DrawerItem: ({ label, onPress }: { label: () => React.ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>{label()}</Pressable>
    ),
  }
})

const svc = ChatService as jest.Mocked<typeof ChatService>

function chatValue(extra: Record<string, unknown> = {}) {
  return {
    myUserId: 'u-me',
    inbox: [] as ChatInboxEntry[],
    inboxLoaded: true,
    inboxError: false,
    unreadTotal: 0,
    refreshInbox: jest.fn(() => Promise.resolve()),
    summaries: {},
    ensureSummaries: jest.fn(),
    ...extra,
  }
}

function msg(id: string, author: string, body: string | null, at: string): ChatMessage {
  return {
    id,
    clientMessageId: `cid-${id}`,
    body,
    author: { id: author, name: author === 'u-me' ? 'me@x.test' : 'Dana Office' },
    mentionedUserIds: [],
    createdAt: at,
    deletedAt: body == null ? at : null,
  }
}

beforeEach(() => {
  mockPush.mockReset()
  mockParams.mockReturnValue({})
  mockChat.mockReturnValue(chatValue())
  svc.getMessages.mockReset().mockResolvedValue([])
  svc.markRead.mockReset().mockResolvedValue({ lastReadAt: null })
  svc.postMessage.mockReset()
})

describe('MessagesScreen', () => {
  const entry: ChatInboxEntry = {
    room: { id: 'r-1', entityType: 'shipment', entityId: '4242', lastMessageAt: null },
    lastMessage: {
      id: 'm-1',
      authorName: 'Dana Office',
      preview: 'call @[Pat Driver](u-me) back',
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    unreadCount: 3,
    unreadMentionCount: 1,
    following: true,
    muted: false,
  }

  it('lists conversations with shipper, preview and unread count, and opens one', () => {
    const ensureSummaries = jest.fn()
    mockChat.mockReturnValue(
      chatValue({
        inbox: [entry],
        ensureSummaries,
        summaries: {
          4242: {
            orderNum: 4242,
            shipperName: 'SMITH, JOHN',
            origin: 'Austin, TX',
            destination: 'Denver, CO',
            packDate: null,
            loadDate: null,
            deliveryDate: null,
          },
        },
      }),
    )
    const { getByText, getByLabelText } = render(<MessagesScreen />)
    expect(ensureSummaries).toHaveBeenCalledWith([4242])
    expect(getByText('#4242 · Smith, John')).toBeTruthy()
    expect(getByText('Austin, TX → Denver, CO')).toBeTruthy()
    expect(getByText('Dana Office: call @Pat Driver back')).toBeTruthy()
    expect(getByText('3')).toBeTruthy()

    fireEvent.press(getByLabelText('Order 4242, 3 unread'))
    expect(mockPush).toHaveBeenCalledWith('/chat/4242')
  })

  it('points a driver with no conversations at the shipment Chat tab', () => {
    const { getByText } = render(<MessagesScreen />)
    expect(getByText(/tap its Chat tab/)).toBeTruthy()
  })

  it('offers to open a typed order number that is not in the list', () => {
    const { getByLabelText, getByText } = render(<MessagesScreen />)
    fireEvent.changeText(getByLabelText('Search conversations'), '#5150')
    fireEvent.press(getByText('Open chat for #5150'))
    expect(mockPush).toHaveBeenCalledWith('/chat/5150')
  })
})

describe('ChatThreadView', () => {
  it('shows my messages and theirs, mentions as names, and a deleted message', async () => {
    svc.getMessages.mockResolvedValue([
      msg('a', 'u-office', 'Hi @[Pat Driver](u-me), ETA?', '2026-10-20T10:00:00.000Z'),
      msg('b', 'u-me', 'About 2pm', '2026-10-20T10:01:00.000Z'),
      msg('c', 'u-office', null, '2026-10-20T10:02:00.000Z'),
    ])
    const { findByText, getByText, getAllByText, queryByText } = render(
      <ChatThreadView orderNum={4242} />,
    )
    expect(await findByText('About 2pm')).toBeTruthy()
    // Their name heads each run of their messages; my reply splits the two.
    expect(getAllByText('Dana Office')).toHaveLength(2)
    expect(queryByText('me@x.test')).toBeNull()
    expect(getByText('@Pat Driver')).toBeTruthy()
    expect(getByText('Message deleted')).toBeTruthy()
  })

  it('sends from the composer and clears it', async () => {
    svc.postMessage.mockReturnValue(new Promise(() => undefined))
    const { getByLabelText, findByText } = render(<ChatThreadView orderNum={4242} />)
    await findByText(/No messages yet/)
    fireEvent.changeText(getByLabelText('Message'), '  On my way  ')
    fireEvent.press(getByLabelText('Send'))
    expect(await findByText('Sending…')).toBeTruthy()
    expect(getByLabelText('Message').props.value).toBe('')
    await waitFor(() =>
      expect(svc.postMessage).toHaveBeenCalledWith(
        4242,
        expect.objectContaining({ body: 'On my way' }),
      ),
    )
  })

  it('explains a move the driver is not on', async () => {
    const { ApiError } = jest.requireActual('@pegasus/api-http')
    svc.getMessages.mockRejectedValue(new ApiError('Forbidden', 'FORBIDDEN', 403))
    const { findByText } = render(<ChatThreadView orderNum={4242} />)
    expect(await findByText('This move’s chat isn’t open to you.')).toBeTruthy()
  })
})

describe('buildRows', () => {
  it('orders newest first with a day divider above each day, and pending sends at the bottom', () => {
    const now = new Date('2026-10-20T12:00:00')
    const pending: PendingMessage = {
      clientMessageId: 'p1',
      body: 'x',
      createdAt: '2026-10-20T11:00:00',
      status: 'queued',
    }
    const rows = buildRows(
      [
        msg('a', 'u-office', 'old', '2026-10-19T09:00:00'),
        msg('b', 'u-office', 'one', '2026-10-20T09:00:00'),
        msg('c', 'u-office', 'two', '2026-10-20T09:01:00'),
        msg('d', 'u-me', 'mine', '2026-10-20T09:02:00'),
      ],
      [pending],
      'u-me',
      now,
    )
    expect(rows.map((r) => (r.kind === 'day' ? r.label : r.key))).toEqual([
      'p:p1',
      'd',
      'c',
      'b',
      'Today',
      'a',
      'Yesterday',
    ])
    const author = (key: string) => rows.find((r) => r.key === key)
    expect(author('b')).toMatchObject({ showAuthor: true, mine: false })
    expect(author('c')).toMatchObject({ showAuthor: false })
    expect(author('d')).toMatchObject({ mine: true, showAuthor: false })
  })
})

describe('shipment Chat tab', () => {
  it('opens on the Chat tab when a link asks for it (?tab=chat)', async () => {
    mockParams.mockReturnValue({ orderNum: '4242', tab: 'chat' })
    ;(TripService.getShipment as jest.Mock).mockResolvedValue({
      order_num: 4242,
      shipper_name: 'Jane Shipper',
    })
    const { findByLabelText, getByRole } = render(<ShipmentDetailScreen />)
    expect(await findByLabelText('Message')).toBeTruthy()
    expect(getByRole('tab', { name: 'Chat' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    await waitFor(() => expect(svc.getMessages).toHaveBeenCalledWith(4242, { limit: 50 }))
  })
})

describe('DrawerContent', () => {
  it('shows the unread total on Messages', () => {
    mockChat.mockReturnValue(chatValue({ unreadTotal: 4 }))
    const props = { navigation: { navigate: jest.fn() } } as unknown as Parameters<
      typeof DrawerContent
    >[0]
    const { getByText, getByLabelText } = render(<DrawerContent {...props} />)
    expect(getByLabelText('4 unread messages')).toBeTruthy()
    fireEvent.press(getByText('Messages'))
    expect(props.navigation.navigate).toHaveBeenCalledWith('messages')
  })
})
