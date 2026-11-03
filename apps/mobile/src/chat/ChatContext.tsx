import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { ChatService, type ChatInboxEntry, type ChatSummary } from '../services/chatService'
import { flushOutbox } from './outbox'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// App-wide chat state for a signed-in driver: who "I" am (for mine-on-the-right
// and the outbox key), the conversation list behind the Messages screen and the
// drawer badge, and a cache of move summaries (shipper, route).
//
// The list polls every 15 s, only while the app is in the foreground (D4), and
// once more the moment it comes back. Summaries are a legacy read, so they are
// fetched once per new order number and kept for 10 minutes — never on a poll
// tick.
//
// Mounted in the root layout ABOVE the stack, because the chat screens are
// pushed on the root stack and not inside the drawer. It resets itself when the
// account changes rather than being remounted by a key — a key here would
// remount the root navigator on every login and logout.
// ---------------------------------------------------------------------------

export const INBOX_POLL_MS = 15_000
const SUMMARY_TTL_MS = 10 * 60_000

type ChatContextValue = {
  /** The caller's TenantUser id; null until /me/driver answers. */
  myUserId: string | null
  inbox: ChatInboxEntry[]
  inboxLoaded: boolean
  inboxError: boolean
  /** Unread messages across followed rooms — the drawer badge. */
  unreadTotal: number
  refreshInbox: () => Promise<void>
  summaries: Record<number, ChatSummary>
  ensureSummaries: (orderNums: readonly number[]) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

function isActive(): boolean {
  return AppState.currentState === 'active'
}

export function ChatProvider({
  enabled,
  accountKey,
  children,
}: {
  enabled: boolean
  /** Identifies the signed-in account; a change clears everything. */
  accountKey: string
  children: React.ReactNode
}) {
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [inbox, setInbox] = useState<ChatInboxEntry[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  const [inboxError, setInboxError] = useState(false)
  const [summaries, setSummaries] = useState<Record<number, ChatSummary>>({})
  const fetchedAt = useRef(new Map<number, number>())
  const inFlight = useRef(false)
  // Answers that arrive after a sign-out or account switch are dropped.
  const account = enabled ? accountKey : null
  const accountRef = useRef(account)
  accountRef.current = account

  useEffect(() => {
    setMyUserId(null)
    setInbox([])
    setInboxLoaded(false)
    setInboxError(false)
    setSummaries({})
    fetchedAt.current.clear()
  }, [account])

  useEffect(() => {
    if (account == null) return
    let cancelled = false
    ChatService.getMyUserId()
      .then((id) => {
        if (!cancelled) setMyUserId(id)
      })
      .catch((error: unknown) => logger.warn('Chat: could not resolve my user id', error))
    return () => {
      cancelled = true
    }
  }, [account])

  const refreshInbox = useCallback(async () => {
    if (account == null || inFlight.current) return
    inFlight.current = true
    try {
      const rows = await ChatService.getInbox()
      if (accountRef.current !== account) return
      setInbox(rows)
      setInboxError(false)
    } catch (error) {
      if (accountRef.current !== account) return
      setInboxError(true)
      logger.warn('Chat: inbox poll failed', error)
    } finally {
      inFlight.current = false
      if (accountRef.current === account) setInboxLoaded(true)
    }
  }, [account])

  // Poll while in the foreground; catch up (and send anything queued) on return.
  useEffect(() => {
    if (account == null) return
    void refreshInbox()
    const id = setInterval(() => {
      if (isActive()) void refreshInbox()
    }, INBOX_POLL_MS)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshInbox()
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [account, refreshInbox])

  // The offline queue goes out once on sign-in and on every foreground.
  useEffect(() => {
    if (account == null || !myUserId) return
    const flush = () => {
      flushOutbox(myUserId)
        .then((sent) => {
          if (sent > 0) void refreshInbox()
        })
        .catch((error: unknown) => logger.warn('Chat: outbox flush failed', error))
    }
    flush()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush()
    })
    return () => sub.remove()
  }, [account, myUserId, refreshInbox])

  const ensureSummaries = useCallback(
    (orderNums: readonly number[]) => {
      if (account == null) return
      const now = Date.now()
      const missing = [...new Set(orderNums)].filter((n) => {
        const at = fetchedAt.current.get(n)
        return at == null || now - at > SUMMARY_TTL_MS
      })
      if (missing.length === 0) return
      // Stamp first so a re-render before the answer doesn't ask again.
      for (const n of missing) fetchedAt.current.set(n, now)
      ChatService.getSummaries(missing)
        .then((rows) => {
          if (rows.length === 0 || accountRef.current !== account) return
          setSummaries((prev) => {
            const next = { ...prev }
            for (const s of rows) next[s.orderNum] = s
            return next
          })
        })
        // The stamps stay: a failed legacy read is retried after the TTL, not
        // on the next poll — retrying a down tunnel every 15 s is the load
        // the poll path must never put on it.
        .catch((error: unknown) => logger.warn('Chat: summaries failed', error))
    },
    [account],
  )

  const unreadTotal = inbox.reduce((sum, e) => sum + (e.following ? e.unreadCount : 0), 0)

  return (
    <ChatContext.Provider
      value={{
        myUserId,
        inbox,
        inboxLoaded,
        inboxError,
        unreadTotal,
        refreshInbox,
        summaries,
        ensureSummaries,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
