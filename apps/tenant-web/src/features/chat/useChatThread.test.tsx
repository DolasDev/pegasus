// The thread's poll: every 3 s while the tab is visible, paused while hidden,
// and an immediate catch-up when the tab comes back (D4).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const fetchMessages = vi.fn()
vi.mock('@/api/queries/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/queries/chat')
  return {
    ...actual,
    fetchMessages: (...args: unknown[]) => fetchMessages(...args),
    markRead: () => Promise.resolve({ lastReadAt: null }),
  }
})

import { THREAD_POLL_MS, useChatThread } from './useChatThread'

let hidden = false

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

const row = {
  id: 'm-1',
  clientMessageId: 'cid-1',
  body: 'hi',
  author: { id: 'u-1', name: 'Ann' },
  mentionedUserIds: [],
  createdAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
}

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  fetchMessages.mockReset()
  fetchMessages.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChatThread polling', () => {
  it('polls after the newest message every 3 s, pauses while hidden, and catches up on return', async () => {
    fetchMessages.mockResolvedValueOnce([row])
    const { result } = renderHook(() => useChatThread(100), { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.state.loaded).toBe(true)
    expect(fetchMessages).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS)
    })
    expect(fetchMessages).toHaveBeenCalledTimes(2)
    expect(fetchMessages).toHaveBeenLastCalledWith(100, { after: 'm-1', limit: 100 })

    hidden = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_POLL_MS * 5)
    })
    expect(fetchMessages).toHaveBeenCalledTimes(2)

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(fetchMessages).toHaveBeenCalledTimes(3)
  })
})
