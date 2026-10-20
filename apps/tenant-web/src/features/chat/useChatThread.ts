import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  chatKeys,
  deleteMessage,
  fetchMessages,
  markRead,
  postMessage,
  type ChatMessage,
} from '@/api/queries/chat'
import {
  initialThreadState,
  newClientMessageId,
  newestMessage,
  threadReducer,
  type ThreadState,
} from './thread-state'

// ---------------------------------------------------------------------------
// The open conversation: first page, a 3-second poll for newer messages while
// the tab is visible (and one immediately when it becomes visible again),
// paging back, optimistic sends with retry, deletes, and the read cursor.
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

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

export function useChatThread(orderNum: number): ChatThread {
  const qc = useQueryClient()
  const [state, dispatch] = useReducer(threadReducer, initialThreadState)
  const [error, setError] = useState<unknown>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const polling = useRef(false)
  const lastMarked = useRef<string | null>(null)

  const refreshLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [...chatKeys.all, 'inbox'] })
  }, [qc])

  // First page.
  useEffect(() => {
    let cancelled = false
    fetchMessages(orderNum, { limit: PAGE_SIZE })
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

  const poll = useCallback(async () => {
    const s = stateRef.current
    if (!s.loaded || polling.current) return
    polling.current = true
    try {
      const newest = newestMessage(s)
      const rows = await fetchMessages(
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

  // Poll while visible; catch up as soon as the tab comes back.
  useEffect(() => {
    const id = setInterval(() => {
      if (!isHidden()) void poll()
    }, THREAD_POLL_MS)
    const onVisible = () => {
      if (!isHidden()) void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  // Advance the read cursor to the newest message the user can see.
  const newest = newestMessage(state)
  useEffect(() => {
    if (!newest || newest.id === lastMarked.current) return
    const mark = () => {
      if (isHidden() || lastMarked.current === newest.id) return
      lastMarked.current = newest.id
      markRead(orderNum, newest.createdAt)
        .then(() => {
          void qc.invalidateQueries({ queryKey: chatKeys.room(orderNum) })
          refreshLists()
        })
        .catch(() => {
          lastMarked.current = null
        })
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [newest, orderNum, qc, refreshLists])

  const deliver = useCallback(
    (clientMessageId: string, body: string) => {
      postMessage(orderNum, { clientMessageId, body })
        .then((row: ChatMessage) => {
          dispatch({ type: 'sent', row })
          refreshLists()
        })
        .catch(() => dispatch({ type: 'sendFailed', clientMessageId }))
    },
    [orderNum, refreshLists],
  )

  const send = useCallback(
    (body: string) => {
      const clientMessageId = newClientMessageId()
      dispatch({
        type: 'send',
        pending: { clientMessageId, body, createdAt: new Date().toISOString(), status: 'sending' },
      })
      deliver(clientMessageId, body)
    },
    [deliver],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const p = stateRef.current.pending.find((x) => x.clientMessageId === clientMessageId)
      if (!p) return
      dispatch({ type: 'retry', clientMessageId })
      deliver(clientMessageId, p.body)
    },
    [deliver],
  )

  const discard = useCallback((clientMessageId: string) => {
    dispatch({ type: 'discard', clientMessageId })
  }, [])

  const loadOlder = useCallback(async () => {
    const oldest = stateRef.current.messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const rows = await fetchMessages(orderNum, { before: oldest.id, limit: PAGE_SIZE })
      dispatch({ type: 'older', rows, pageSize: PAGE_SIZE })
    } finally {
      setLoadingOlder(false)
    }
  }, [orderNum])

  const remove = useCallback(
    async (messageId: string) => {
      const row = await deleteMessage(messageId)
      dispatch({ type: 'replaced', row })
      refreshLists()
    },
    [refreshLists],
  )

  return { state, error, loadingOlder, send, retry, discard, loadOlder, remove }
}
