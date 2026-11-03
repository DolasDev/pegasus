import { AppState, type AppStateStatus } from 'react-native'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { ApiError } from '@pegasus/api-http'
import { ChatService, type ChatMessage } from '../services/chatService'
import { addToOutbox, listOutbox } from './outbox'
import { THREAD_POLL_MS, useChatThread } from './useChatThread'

jest.mock('../services/chatService', () => ({
  ChatService: {
    getMessages: jest.fn(),
    postMessage: jest.fn(),
    markRead: jest.fn(),
    deleteMessage: jest.fn(),
  },
}))

// The outbox is real but backed by an in-memory map.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => {
        store.set(k, v)
        return Promise.resolve()
      },
      removeItem: (k: string) => {
        store.delete(k)
        return Promise.resolve()
      },
      clear: () => {
        store.clear()
        return Promise.resolve()
      },
    },
  }
})

const svc = ChatService as jest.Mocked<typeof ChatService>

function msg(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    clientMessageId: `cid-${id}`,
    body: `body ${id}`,
    author: { id: 'u-2', name: 'Office' },
    mentionedUserIds: [],
    createdAt: `2026-10-20T10:00:0${id.length}.000Z`,
    deletedAt: null,
    ...extra,
  }
}

let appState: AppStateStatus
let listeners: Array<(s: AppStateStatus) => void>

function setAppState(next: AppStateStatus) {
  appState = next
  for (const l of [...listeners]) l(next)
}

beforeEach(async () => {
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
  svc.getMessages.mockReset().mockResolvedValue([])
  svc.postMessage.mockReset()
  svc.markRead.mockReset().mockResolvedValue({ lastReadAt: null })
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default
  await AsyncStorage.clear()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useChatThread', () => {
  it('polls every 3 s in the foreground, pauses in the background, and catches up on return', async () => {
    svc.getMessages.mockResolvedValueOnce([msg('a')])
    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() => expect(result.current.state.loaded).toBe(true))
    expect(svc.markRead).toHaveBeenCalledWith(4242, msg('a').createdAt)

    await act(async () => {
      jest.advanceTimersByTime(THREAD_POLL_MS)
    })
    expect(svc.getMessages).toHaveBeenLastCalledWith(4242, { after: 'a', limit: 100 })
    const afterForeground = svc.getMessages.mock.calls.length

    act(() => setAppState('background'))
    await act(async () => {
      jest.advanceTimersByTime(THREAD_POLL_MS * 5)
    })
    expect(svc.getMessages.mock.calls.length).toBe(afterForeground)

    svc.getMessages.mockResolvedValueOnce([msg('bb')])
    await act(async () => setAppState('active'))
    await waitFor(() => expect(result.current.state.messages.map((m) => m.id)).toEqual(['a', 'bb']))
  })

  it('writes a send to the outbox before posting and clears it once confirmed', async () => {
    let resolvePost: (m: ChatMessage) => void = () => undefined
    svc.postMessage.mockReturnValue(new Promise((r) => (resolvePost = r)))
    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() => expect(result.current.state.loaded).toBe(true))

    act(() => result.current.send('On my way'))
    expect(result.current.state.pending[0]?.status).toBe('sending')
    await waitFor(() => expect(svc.postMessage).toHaveBeenCalled())
    const { clientMessageId } = svc.postMessage.mock.calls[0]?.[1] as { clientMessageId: string }
    expect(await listOutbox('u-1', 4242)).toHaveLength(1)

    await act(async () =>
      resolvePost(msg('x', { clientMessageId, author: { id: 'u-1', name: 'Me' } })),
    )
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0))
    expect(await listOutbox('u-1')).toEqual([])
  })

  it('queues a send that fails for want of signal and resends it, same id, on foreground', async () => {
    svc.postMessage.mockRejectedValueOnce(new TypeError('Network request failed'))
    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() => expect(result.current.state.loaded).toBe(true))

    act(() => result.current.send('Running late'))
    await waitFor(() => expect(result.current.state.pending[0]?.status).toBe('queued'))
    const firstId = (svc.postMessage.mock.calls[0]?.[1] as { clientMessageId: string })
      .clientMessageId

    svc.postMessage.mockResolvedValueOnce(msg('y', { clientMessageId: firstId }))
    await act(async () => setAppState('active'))
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0))
    expect(
      (svc.postMessage.mock.calls[1]?.[1] as { clientMessageId: string }).clientMessageId,
    ).toBe(firstId)
  })

  it('marks a refused send failed and leaves it for the user', async () => {
    svc.postMessage.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))
    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() => expect(result.current.state.loaded).toBe(true))
    act(() => result.current.send('hello'))
    await waitFor(() => expect(result.current.state.pending[0]?.status).toBe('failed'))

    await act(async () => setAppState('active'))
    expect(svc.postMessage).toHaveBeenCalledTimes(1)

    act(() => result.current.discard(result.current.state.pending[0]!.clientMessageId))
    expect(result.current.state.pending).toEqual([])
    await waitFor(async () => expect(await listOutbox('u-1')).toEqual([]))
  })

  it('restores and resends what an earlier visit left in the outbox', async () => {
    await addToOutbox('u-1', {
      orderNum: 4242,
      clientMessageId: 'cid-left-behind',
      body: 'sent offline',
      createdAt: '2026-10-20T09:00:00.000Z',
    })
    await addToOutbox('u-1', {
      orderNum: 9999,
      clientMessageId: 'cid-other-room',
      body: 'elsewhere',
      createdAt: '2026-10-20T09:00:00.000Z',
    })
    svc.postMessage.mockResolvedValue(msg('z', { clientMessageId: 'cid-left-behind' }))

    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() =>
      expect(svc.postMessage).toHaveBeenCalledWith(4242, {
        clientMessageId: 'cid-left-behind',
        body: 'sent offline',
      }),
    )
    expect(svc.postMessage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0))
    expect((await listOutbox('u-1')).map((e) => e.clientMessageId)).toEqual(['cid-other-room'])
  })

  it('reports a first-page failure (e.g. not your move)', async () => {
    svc.getMessages.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))
    const { result } = renderHook(() => useChatThread(4242, 'u-1'))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
  })
})
