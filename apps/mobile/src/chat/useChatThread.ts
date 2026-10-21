import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { ChatService, type ChatMessage } from '../services/chatService'
import {
  addToOutbox,
  deliver,
  isRefusal,
  listOutbox,
  removeFromOutbox,
  type OutboxEntry,
} from './outbox'
import {
  initialThreadState,
  newClientMessageId,
  newestMessage,
  threadReducer,
  type PendingMessage,
  type ThreadState,
} from './thread-state'

// ---------------------------------------------------------------------------
// The open conversation: first page, a 3-second poll for newer messages while
// the app is in the foreground (and one immediately when it comes back),
// paging back, optimistic sends through the persisted outbox, deletes, and the
// read cursor. Ported from tenant-web's useChatThread, with AppState standing
// in for document.hidden — RN has no `document`, and a guard written against it
// would simply never pause.
//
// Mount it per room (key the component by order number); it does not reset
// itself when `orderNum` changes.
// ---------------------------------------------------------------------------

export const THREAD_POLL_MS = 3_000
export const PAGE_SIZE = 50
const POLL_LIMIT = 100

export type ChatThread = {
  state: ThreadState
  /** Set when the first page failed (e.g. 403: not your move). */
  error: unknown
  loadingOlder: boolean
  send: (body: string) => void
  retry: (clientMessageId: string) => void
  discard: (clientMessageId: string) => void
  loadOlder: () => Promise<void>
  remove: (messageId: string) => Promise<void>
}

function isActive(): boolean {
  return AppState.currentState === 'active'
}

export function useChatThread(
  orderNum: number,
  myUserId: string | null,
  onChanged?: () => void,
): ChatThread {
  const [state, dispatch] = useReducer(threadReducer, initialThreadState)
  const [error, setError] = useState<unknown>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const polling = useRef(false)
  const lastMarked = useRef<string | null>(null)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const changed = useCallback(() => onChangedRef.current?.(), [])

  // First page.
  useEffect(() => {
    let cancelled = false
    ChatService.getMessages(orderNum, { limit: PAGE_SIZE })
      .then((rows) => {
        if (!cancelled) dispatch({ type: 'loaded', rows, pageSize: PAGE_SIZE })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [orderNum])

  // Sends one pending message and records the outcome. Without a user id
  // (still resolving) it is sent but not persisted.
  const send1 = useCallback(
    (p: PendingMessage) => {
      const entry: OutboxEntry = {
        orderNum,
        clientMessageId: p.clientMessageId,
        body: p.body,
        createdAt: p.createdAt,
      }
      const attempt = myUserId
        ? deliver(myUserId, entry)
        : ChatService.postMessage(orderNum, { clientMessageId: p.clientMessageId, body: p.body })
      attempt
        .then((row: ChatMessage) => {
          dispatch({ type: 'sent', row })
          changed()
        })
        .catch((err: unknown) =>
          dispatch({
            type: 'sendFailed',
            clientMessageId: p.clientMessageId,
            permanent: isRefusal(err),
          }),
        )
    },
    [orderNum, myUserId, changed],
  )

  // Sends left in the outbox from an earlier visit go out again on open.
  useEffect(() => {
    if (!myUserId) return
    let cancelled = false
    listOutbox(myUserId, orderNum)
      .then((entries) => {
        if (cancelled || entries.length === 0) return
        const restored: PendingMessage[] = entries.map((e) => ({
          clientMessageId: e.clientMessageId,
          body: e.body,
          createdAt: e.createdAt,
          status: e.refused ? 'failed' : 'sending',
        }))
        dispatch({ type: 'restore', pending: restored })
        for (const p of restored) if (p.status === 'sending') send1(p)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [orderNum, myUserId, send1])

  const poll = useCallback(async () => {
    const s = stateRef.current
    if (!s.loaded || polling.current) return
    polling.current = true
    try {
      const newest = newestMessage(s)
      const rows = await ChatService.getMessages(
        orderNum,
        newest ? { after: newest.id, limit: POLL_LIMIT } : { limit: PAGE_SIZE },
      )
      if (rows.length > 0) dispatch({ type: 'newer', rows })
    } catch {
      // A missed poll is retried on the next tick.
    } finally {
      polling.current = false
    }
  }, [orderNum])

  // Poll in the foreground; on return, catch up and resend what was queued.
  useEffect(() => {
    const id = setInterval(() => {
      if (isActive()) void poll()
    }, THREAD_POLL_MS)
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      void poll()
      for (const p of stateRef.current.pending) {
        if (p.status === 'queued') {
          dispatch({ type: 'retry', clientMessageId: p.clientMessageId })
          send1(p)
        }
      }
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [poll, send1])

  // Advance the read cursor to the newest message on screen.
  const newest = newestMessage(state)
  useEffect(() => {
    if (!newest || newest.id === lastMarked.current) return
    const mark = () => {
      if (!isActive() || lastMarked.current === newest.id) return
      lastMarked.current = newest.id
      ChatService.markRead(orderNum, newest.createdAt)
        .then(() => changed())
        .catch(() => {
          lastMarked.current = null
        })
    }
    mark()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') mark()
    })
    return () => sub.remove()
  }, [newest, orderNum, changed])

  const send = useCallback(
    (body: string) => {
      const p: PendingMessage = {
        clientMessageId: newClientMessageId(),
        body,
        createdAt: new Date().toISOString(),
        status: 'sending',
      }
      dispatch({ type: 'send', pending: p })
      // Into the outbox BEFORE the POST, so a kill mid-request loses nothing.
      const queued = myUserId
        ? addToOutbox(myUserId, {
            orderNum,
            clientMessageId: p.clientMessageId,
            body,
            createdAt: p.createdAt,
          })
        : Promise.resolve()
      void queued.then(() => send1(p))
    },
    [orderNum, myUserId, send1],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const p = stateRef.current.pending.find((x) => x.clientMessageId === clientMessageId)
      if (!p) return
      dispatch({ type: 'retry', clientMessageId })
      send1(p)
    },
    [send1],
  )

  const discard = useCallback(
    (clientMessageId: string) => {
      dispatch({ type: 'discard', clientMessageId })
      if (myUserId) void removeFromOutbox(myUserId, clientMessageId)
    },
    [myUserId],
  )

  const loadOlder = useCallback(async () => {
    const oldest = stateRef.current.messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const rows = await ChatService.getMessages(orderNum, { before: oldest.id, limit: PAGE_SIZE })
      dispatch({ type: 'older', rows, pageSize: PAGE_SIZE })
    } finally {
      setLoadingOlder(false)
    }
  }, [orderNum])

  const remove = useCallback(
    async (messageId: string) => {
      const row = await ChatService.deleteMessage(messageId)
      dispatch({ type: 'replaced', row })
      changed()
    },
    [changed],
  )

  return { state, error, loadingOlder, send, retry, discard, loadOlder, remove }
}
