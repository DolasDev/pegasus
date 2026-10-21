import * as Crypto from 'expo-crypto'
import { isValidClientMessageId } from '@pegasus/domain'
import type { ChatMessage } from '../services/chatService'
import {
  initialThreadState,
  mergeMessages,
  newClientMessageId,
  newestMessage,
  threadReducer,
  type PendingMessage,
  type ThreadState,
} from './thread-state'

function msg(id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    clientMessageId: `cid-${id}`,
    body: `body ${id}`,
    author: { id: 'u-1', name: 'Ann' },
    mentionedUserIds: [],
    createdAt,
    deletedAt: null,
    ...extra,
  }
}

const T1 = '2026-10-20T10:00:00.000Z'
const T2 = '2026-10-20T10:01:00.000Z'
const T3 = '2026-10-20T10:02:00.000Z'

const pending = (cid: string, status: PendingMessage['status'] = 'sending'): PendingMessage => ({
  clientMessageId: cid,
  body: 'hi',
  createdAt: T2,
  status,
})

describe('mergeMessages', () => {
  it('keeps one row per id, oldest first, with ties broken by id', () => {
    const merged = mergeMessages([msg('b', T2), msg('a', T1)], [msg('c', T2), msg('a', T1)])
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('lets the incoming row win (e.g. a deletion)', () => {
    const merged = mergeMessages([msg('a', T1)], [msg('a', T1, { body: null, deletedAt: T2 })])
    expect(merged[0]?.body).toBeNull()
  })
})

describe('threadReducer', () => {
  const loaded = (rows: ChatMessage[], pageSize = 50): ThreadState =>
    threadReducer(initialThreadState, { type: 'loaded', rows, pageSize })

  it('knows whether older messages may exist from the first page size', () => {
    expect(loaded([msg('a', T1)], 1).hasOlder).toBe(true)
    expect(loaded([msg('a', T1)], 50).hasOlder).toBe(false)
  })

  it('pages back and stops when a page comes up short', () => {
    let s = loaded([msg('c', T3)], 1)
    s = threadReducer(s, { type: 'older', rows: [msg('b', T2)], pageSize: 1 })
    expect(s.hasOlder).toBe(true)
    s = threadReducer(s, { type: 'older', rows: [], pageSize: 1 })
    expect(s.hasOlder).toBe(false)
    expect(s.messages.map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('replaces a pending send with the confirmed row, whether the POST or a poll lands first', () => {
    let s = threadReducer(loaded([msg('a', T1)]), { type: 'send', pending: pending('cid-x') })
    expect(s.pending).toHaveLength(1)

    const viaPoll = threadReducer(s, { type: 'newer', rows: [msg('x', T2)] })
    expect(viaPoll.pending).toHaveLength(0)
    expect(viaPoll.messages.map((m) => m.id)).toEqual(['a', 'x'])

    s = threadReducer(s, { type: 'sent', row: msg('x', T2) })
    expect(s.pending).toHaveLength(0)
    s = threadReducer(s, { type: 'newer', rows: [msg('x', T2)] })
    expect(s.messages.map((m) => m.id)).toEqual(['a', 'x'])
    expect(newestMessage(s)?.id).toBe('x')
  })

  it('queues a transient failure and fails a refusal, then retries and discards', () => {
    let s = threadReducer(loaded([]), { type: 'send', pending: pending('cid-x') })
    s = threadReducer(s, { type: 'sendFailed', clientMessageId: 'cid-x', permanent: false })
    expect(s.pending[0]?.status).toBe('queued')
    s = threadReducer(s, { type: 'sendFailed', clientMessageId: 'cid-x', permanent: true })
    expect(s.pending[0]?.status).toBe('failed')
    s = threadReducer(s, { type: 'retry', clientMessageId: 'cid-x' })
    expect(s.pending[0]?.status).toBe('sending')
    s = threadReducer(s, { type: 'discard', clientMessageId: 'cid-x' })
    expect(s.pending).toEqual([])
  })

  it('restores outbox entries once, skipping ones already held or already confirmed', () => {
    let s = threadReducer(initialThreadState, {
      type: 'restore',
      pending: [pending('cid-x', 'queued'), pending('cid-a', 'queued')],
    })
    expect(s.pending.map((p) => p.clientMessageId)).toEqual(['cid-x', 'cid-a'])
    // The first page shows cid-a was delivered after all: it drops out.
    s = threadReducer(s, { type: 'loaded', rows: [msg('a', T1)], pageSize: 50 })
    expect(s.pending.map((p) => p.clientMessageId)).toEqual(['cid-x'])
    // Restoring again changes nothing.
    const again = threadReducer(s, {
      type: 'restore',
      pending: [pending('cid-x', 'queued'), pending('cid-a', 'queued')],
    })
    expect(again).toBe(s)
  })

  it('swaps in a deleted row in place', () => {
    let s = loaded([msg('a', T1), msg('b', T2)])
    s = threadReducer(s, { type: 'replaced', row: msg('a', T1, { body: null, deletedAt: T3 }) })
    expect(s.messages.map((m) => m.body)).toEqual([null, 'body b'])
  })
})

describe('newClientMessageId', () => {
  it('comes from expo-crypto and is accepted by the API rule', () => {
    const id = newClientMessageId()
    expect(Crypto.randomUUID).toHaveBeenCalled()
    expect(isValidClientMessageId(id)).toBe(true)
  })
})
