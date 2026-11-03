import React from 'react'
import { AppState, Text, type AppStateStatus } from 'react-native'
import { act, render, waitFor } from '@testing-library/react-native'
import { ChatService, type ChatInboxEntry } from '../services/chatService'
import { flushOutbox } from './outbox'
import { ChatProvider, INBOX_POLL_MS, useChat } from './ChatContext'

jest.mock('../services/chatService', () => ({
  ChatService: { getMyUserId: jest.fn(), getInbox: jest.fn(), getSummaries: jest.fn() },
}))
jest.mock('./outbox', () => ({ flushOutbox: jest.fn() }))

const svc = ChatService as jest.Mocked<typeof ChatService>
const flush = flushOutbox as jest.Mock

function entry(orderNum: string, unreadCount: number, following = true): ChatInboxEntry {
  return {
    room: { id: `r-${orderNum}`, entityType: 'shipment', entityId: orderNum, lastMessageAt: null },
    lastMessage: null,
    unreadCount,
    unreadMentionCount: 0,
    following,
    muted: false,
  }
}

let appState: AppStateStatus
let listeners: Array<(s: AppStateStatus) => void>
function setAppState(next: AppStateStatus) {
  appState = next
  for (const l of [...listeners]) l(next)
}

let latest: ReturnType<typeof useChat>
function Probe() {
  latest = useChat()
  return <Text>{latest.unreadTotal}</Text>
}

function renderProvider(props: { enabled: boolean; accountKey: string }) {
  const ui = (p: typeof props) => (
    <ChatProvider {...p}>
      <Probe />
    </ChatProvider>
  )
  const r = render(ui(props))
  return { ...r, rerenderWith: (p: typeof props) => r.rerender(ui(p)) }
}

beforeEach(() => {
  jest.useFakeTimers()
  appState = 'active'
  listeners = []
  Object.defineProperty(AppState, 'currentState', { get: () => appState, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listeners.push(handler as (s: AppStateStatus) => void)
    return {
      remove: () => {
        listeners = listeners.filter((l) => l !== handler)
      },
    } as ReturnType<typeof AppState.addEventListener>
  })
  svc.getMyUserId.mockReset().mockResolvedValue('u-1')
  svc.getInbox.mockReset().mockResolvedValue([entry('4242', 2), entry('5150', 5, false)])
  svc.getSummaries.mockReset().mockResolvedValue([])
  flush.mockReset().mockResolvedValue(0)
})

afterEach(() => jest.useRealTimers())

describe('ChatProvider', () => {
  it('does nothing while signed out', async () => {
    renderProvider({ enabled: false, accountKey: '' })
    await act(async () => {
      jest.advanceTimersByTime(INBOX_POLL_MS * 2)
    })
    expect(svc.getInbox).not.toHaveBeenCalled()
    expect(svc.getMyUserId).not.toHaveBeenCalled()
  })

  it('badges unread across followed rooms only, and polls only in the foreground', async () => {
    const { getByText } = renderProvider({ enabled: true, accountKey: 't:a' })
    await waitFor(() => expect(getByText('2')).toBeTruthy())
    expect(svc.getInbox).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(INBOX_POLL_MS)
    })
    expect(svc.getInbox).toHaveBeenCalledTimes(2)

    act(() => setAppState('background'))
    await act(async () => {
      jest.advanceTimersByTime(INBOX_POLL_MS * 4)
    })
    expect(svc.getInbox).toHaveBeenCalledTimes(2)

    await act(async () => setAppState('active'))
    expect(svc.getInbox).toHaveBeenCalledTimes(3)
  })

  it('flushes the outbox for my user on sign-in and on every foreground', async () => {
    renderProvider({ enabled: true, accountKey: 't:a' })
    await waitFor(() => expect(flush).toHaveBeenCalledWith('u-1'))
    act(() => setAppState('background'))
    await act(async () => setAppState('active'))
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('fetches a summary once per order and does not retry a failure on the next call', async () => {
    renderProvider({ enabled: true, accountKey: 't:a' })
    await waitFor(() => expect(latest.inboxLoaded).toBe(true))
    svc.getSummaries.mockRejectedValueOnce(new Error('tunnel down'))
    await act(async () => latest.ensureSummaries([4242, 5150]))
    await act(async () => latest.ensureSummaries([4242, 5150]))
    expect(svc.getSummaries).toHaveBeenCalledTimes(1)

    svc.getSummaries.mockResolvedValueOnce([
      {
        orderNum: 7,
        shipperName: 'Lee',
        origin: null,
        destination: null,
        packDate: null,
        loadDate: null,
        deliveryDate: null,
      },
    ])
    await act(async () => latest.ensureSummaries([4242, 7]))
    expect(svc.getSummaries).toHaveBeenLastCalledWith([7])
    await waitFor(() => expect(latest.summaries[7]?.shipperName).toBe('Lee'))
  })

  it('clears everything when the account changes, without remounting its children', async () => {
    const { getByText, rerenderWith } = renderProvider({ enabled: true, accountKey: 't:a' })
    await waitFor(() => expect(getByText('2')).toBeTruthy())
    await waitFor(() => expect(latest.myUserId).toBe('u-1'))

    svc.getMyUserId.mockResolvedValue('u-2')
    svc.getInbox.mockResolvedValue([])
    rerenderWith({ enabled: true, accountKey: 't:b' })
    await waitFor(() => expect(getByText('0')).toBeTruthy())
    await waitFor(() => expect(latest.myUserId).toBe('u-2'))

    rerenderWith({ enabled: false, accountKey: '' })
    await waitFor(() => expect(latest.myUserId).toBeNull())
    expect(latest.inbox).toEqual([])
  })
})
