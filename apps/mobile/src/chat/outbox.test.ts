import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@pegasus/api-http'
import { ChatService } from '../services/chatService'
import {
  addToOutbox,
  deliver,
  flushOutbox,
  isRefusal,
  listOutbox,
  removeFromOutbox,
  type OutboxEntry,
} from './outbox'

jest.mock('../services/chatService', () => ({
  ChatService: { postMessage: jest.fn() },
}))

const post = ChatService.postMessage as jest.Mock

// A real in-memory store behind the AsyncStorage mock.
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  ;(AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(store.get(k) ?? null),
  )
  ;(AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    store.set(k, v)
    return Promise.resolve()
  })
  ;(AsyncStorage.removeItem as jest.Mock).mockImplementation((k: string) => {
    store.delete(k)
    return Promise.resolve()
  })
  post.mockReset()
})

const entry = (cid: string, orderNum = 4242): OutboxEntry => ({
  orderNum,
  clientMessageId: cid,
  body: `body ${cid}`,
  createdAt: '2026-10-20T10:00:00.000Z',
})

const row = (cid: string) => ({ id: `m-${cid}`, clientMessageId: cid })

describe('outbox storage', () => {
  it('keeps one queue per user, so another login never sends my messages', async () => {
    await addToOutbox('u-1', entry('a'))
    await addToOutbox('u-2', entry('b'))
    expect((await listOutbox('u-1')).map((e) => e.clientMessageId)).toEqual(['a'])
    expect((await listOutbox('u-2')).map((e) => e.clientMessageId)).toEqual(['b'])
  })

  it('adds an entry once and filters by room', async () => {
    await Promise.all([
      addToOutbox('u-1', entry('a', 1)),
      addToOutbox('u-1', entry('a', 1)),
      addToOutbox('u-1', entry('b', 2)),
    ])
    expect(await listOutbox('u-1')).toHaveLength(2)
    expect((await listOutbox('u-1', 2)).map((e) => e.clientMessageId)).toEqual(['b'])
  })

  it('drops the key when the last entry goes', async () => {
    await addToOutbox('u-1', entry('a'))
    await removeFromOutbox('u-1', 'a')
    expect(store.size).toBe(0)
  })

  it('treats a corrupt record as empty', async () => {
    store.set('pegasus_chat_outbox.u-1', '{nope')
    expect(await listOutbox('u-1')).toEqual([])
  })
})

describe('deliver', () => {
  it('removes the entry once the server has it', async () => {
    await addToOutbox('u-1', entry('a'))
    post.mockResolvedValue(row('a'))
    await deliver('u-1', entry('a'))
    expect(post).toHaveBeenCalledWith(4242, { clientMessageId: 'a', body: 'body a' })
    expect(await listOutbox('u-1')).toEqual([])
  })

  it('marks a 4xx refused and keeps a network failure queued', async () => {
    await addToOutbox('u-1', entry('a'))
    await addToOutbox('u-1', entry('b'))
    post.mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))
    await expect(deliver('u-1', entry('a'))).rejects.toThrow('Forbidden')
    post.mockRejectedValueOnce(new TypeError('Network request failed'))
    await expect(deliver('u-1', entry('b'))).rejects.toThrow('Network')
    const all = await listOutbox('u-1')
    expect(all.find((e) => e.clientMessageId === 'a')?.refused).toBe(true)
    expect(all.find((e) => e.clientMessageId === 'b')?.refused).toBeUndefined()
  })
})

describe('isRefusal', () => {
  it('is true only for a 4xx from the API', () => {
    expect(isRefusal(new ApiError('x', 'X', 400))).toBe(true)
    expect(isRefusal(new ApiError('x', 'X', 503))).toBe(false)
    expect(isRefusal(new TypeError('Network request failed'))).toBe(false)
  })
})

describe('flushOutbox', () => {
  it('sends queued entries in order, skips refused ones, and stops at the first transient failure', async () => {
    await addToOutbox('u-1', { ...entry('r'), refused: true })
    await addToOutbox('u-1', entry('a'))
    await addToOutbox('u-1', entry('b'))
    await addToOutbox('u-1', entry('c'))
    post
      .mockResolvedValueOnce(row('a'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))

    expect(await flushOutbox('u-1')).toBe(1)
    expect(post).toHaveBeenCalledTimes(2)
    expect((await listOutbox('u-1')).map((e) => e.clientMessageId)).toEqual(['r', 'b', 'c'])
  })

  it('carries on past a refusal', async () => {
    await addToOutbox('u-1', entry('a'))
    await addToOutbox('u-1', entry('b'))
    post
      .mockRejectedValueOnce(new ApiError('Forbidden', 'FORBIDDEN', 403))
      .mockResolvedValueOnce(row('b'))
    expect(await flushOutbox('u-1')).toBe(1)
    expect(await listOutbox('u-1')).toEqual([{ ...entry('a'), refused: true }])
  })
})
