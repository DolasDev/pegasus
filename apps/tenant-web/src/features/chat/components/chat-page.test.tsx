// ---------------------------------------------------------------------------
// Move chat page — the conversation list and the open conversation, against a
// fake API behind `apiFetch` with a real QueryClient, so the query wiring
// (which inbox a filter reads, the summaries batch, sends, retries, access
// errors) is exercised end to end in the component.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@pegasus/api-http'
import type { ChatInboxEntry, ChatMessage } from '@/api/queries/chat'

type Call = { path: string; init?: RequestInit }
let calls: Call[] = []
let handler: (path: string, init?: RequestInit) => unknown = () => []

vi.mock('@/api/client', () => ({
  apiFetch: (path: string, init?: RequestInit) => {
    calls.push({ path, init })
    try {
      return Promise.resolve(handler(path, init))
    } catch (err) {
      return Promise.reject(err)
    }
  },
}))

import {
  ConversationList,
  filterEntries,
  inboxSourceFor,
  previewText,
  searchedOrderNum,
} from './ConversationList'
import { ConversationPane } from './ConversationPane'
import { parseOrderParam } from '@/routes/messages'

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function entry(orderNum: number, extra: Partial<ChatInboxEntry> = {}): ChatInboxEntry {
  return {
    room: {
      id: `r-${orderNum}`,
      entityType: 'shipment',
      entityId: String(orderNum),
      lastMessageAt: '2026-10-20T10:00:00.000Z',
    },
    lastMessage: {
      id: `m-${orderNum}`,
      authorName: 'Ann',
      preview: 'hello @[Bo](u-2)',
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    unreadCount: 0,
    unreadMentionCount: 0,
    following: true,
    muted: false,
    ...extra,
  }
}

function message(id: string, authorId: string, body: string, at: string): ChatMessage {
  return {
    id,
    clientMessageId: `cid-${id}`,
    body,
    author: { id: authorId, name: authorId === 'me' ? 'Me Myself' : 'Ann Lee' },
    mentionedUserIds: [],
    createdAt: at,
    deletedAt: null,
  }
}

beforeEach(() => {
  calls = []
  handler = () => []
})

afterEach(() => {
  vi.useRealTimers()
})

// ── pure helpers ───────────────────────────────────────────────────────────

describe('conversation list helpers', () => {
  it("reads every room for an employee's All, and followed rooms otherwise", () => {
    expect(inboxSourceFor('all', true)).toBe('all')
    expect(inboxSourceFor('unread', true)).toBe('all')
    expect(inboxSourceFor('all', false)).toBe('following')
    expect(inboxSourceFor('following', true)).toBe('following')
  })

  it('filters by unread, mentions and search text (order number or shipper)', () => {
    const list = [
      entry(100, { unreadCount: 2 }),
      entry(200, { unreadCount: 1, unreadMentionCount: 1 }),
      entry(300),
    ]
    const summaries = new Map([
      [
        300,
        {
          orderNum: 300,
          shipperName: 'SMITH',
          origin: null,
          destination: null,
          packDate: null,
          loadDate: null,
          deliveryDate: null,
        },
      ],
    ])
    const ids = (xs: ChatInboxEntry[]) => xs.map((e) => e.room.entityId)
    expect(ids(filterEntries(list, 'unread', '', summaries))).toEqual(['100', '200'])
    expect(ids(filterEntries(list, 'mentions', '', summaries))).toEqual(['200'])
    expect(ids(filterEntries(list, 'all', '#2', summaries))).toEqual(['200'])
    expect(ids(filterEntries(list, 'all', 'smi', summaries))).toEqual(['300'])
  })

  it('recognizes a typed order number', () => {
    expect(searchedOrderNum('#123')).toBe(123)
    expect(searchedOrderNum(' 45 ')).toBe(45)
    expect(searchedOrderNum('smith')).toBeNull()
    expect(searchedOrderNum('99999999999')).toBeNull()
    expect(parseOrderParam('123')).toBe(123)
    expect(parseOrderParam('0')).toBeNull()
    expect(parseOrderParam('abc')).toBeNull()
  })

  it('shows mentions as @Name in previews and says when a message was deleted', () => {
    expect(previewText('hello @[Bo](u-2)')).toBe('hello @Bo')
    expect(previewText(null)).toBe('Message deleted')
  })
})

// ── the list ───────────────────────────────────────────────────────────────

describe('ConversationList', () => {
  it('lists conversations with shipper names from one summaries call, and unread counts', async () => {
    handler = (path) => {
      if (path.startsWith('/api/v1/chat/inbox')) return [entry(100, { unreadCount: 3 }), entry(200)]
      if (path.startsWith('/api/v1/chat/summaries')) {
        return [
          {
            orderNum: 100,
            shipperName: 'SMITH, JOHN',
            origin: 'Austin, TX',
            destination: 'Denver, CO',
            packDate: null,
            loadDate: null,
            deliveryDate: null,
          },
        ]
      }
      return []
    }
    wrap(<ConversationList isEmployee selected={null} onOpen={() => {}} />)
    expect(await screen.findByText(/Smith, John/)).toBeInTheDocument()
    expect(screen.getByText('Austin, TX → Denver, CO')).toBeInTheDocument()
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument()
    expect(calls.map((c) => c.path)).toContain('/api/v1/chat/inbox?filter=all')
    expect(calls.filter((c) => c.path.startsWith('/api/v1/chat/summaries'))).toHaveLength(1)
    expect(calls.find((c) => c.path.startsWith('/api/v1/chat/summaries'))?.path).toBe(
      '/api/v1/chat/summaries?entityType=shipment&ids=100,200',
    )
  })

  it("reads a driver's followed rooms, never the all-rooms inbox", async () => {
    handler = (path) => (path.startsWith('/api/v1/chat/inbox') ? [entry(100)] : [])
    wrap(<ConversationList isEmployee={false} selected={null} onOpen={() => {}} />)
    await screen.findByText('#100')
    expect(calls.some((c) => c.path === '/api/v1/chat/inbox?filter=following')).toBe(true)
    expect(calls.some((c) => c.path === '/api/v1/chat/inbox?filter=all')).toBe(false)
  })

  it('opens a typed order number that has no conversation yet', async () => {
    handler = (path) => (path.startsWith('/api/v1/chat/inbox') ? [] : [])
    const onOpen = vi.fn()
    wrap(<ConversationList isEmployee selected={null} onOpen={onOpen} />)
    fireEvent.change(screen.getByPlaceholderText('Order # or shipper'), {
      target: { value: '#777' },
    })
    fireEvent.click(await screen.findByText('Open chat for order #777'))
    expect(onOpen).toHaveBeenCalledWith(777)
  })

  it('opens a listed conversation when clicked', async () => {
    handler = (path) => (path.startsWith('/api/v1/chat/inbox') ? [entry(100)] : [])
    const onOpen = vi.fn()
    wrap(<ConversationList isEmployee selected={null} onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('#100'))
    expect(onOpen).toHaveBeenCalledWith(100)
  })
})

// ── the conversation ───────────────────────────────────────────────────────

describe('ConversationPane', () => {
  const room = {
    room: { id: 'r-1', entityType: 'shipment', entityId: '100', lastMessageAt: null },
    membership: { following: true, muted: false, lastReadAt: '2026-10-20T10:00:30.000Z' },
    unreadCount: 1,
  }

  function api(
    overrides: { post?: (body: { clientMessageId: string; body: string }) => unknown } = {},
  ) {
    return (path: string, init?: RequestInit) => {
      if (path === '/api/v1/chat/rooms/shipment/100') return room
      if (path.startsWith('/api/v1/chat/rooms/shipment/100/messages') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { clientMessageId: string; body: string }
        if (overrides.post) return overrides.post(body)
        return {
          ...message('m-new', 'me', body.body, '2026-10-20T11:00:00.000Z'),
          clientMessageId: body.clientMessageId,
        }
      }
      if (path.startsWith('/api/v1/chat/rooms/shipment/100/messages')) {
        if (path.includes('after=')) return []
        return [
          message('m-1', 'u-ann', 'Truck is loaded', '2026-10-20T10:00:00.000Z'),
          message('m-2', 'me', 'Thanks!', '2026-10-20T10:00:20.000Z'),
          message('m-3', 'u-ann', 'Heads up @[Me Myself](me)', '2026-10-20T10:01:00.000Z'),
        ]
      }
      if (path.endsWith('/mentionable')) {
        return [
          { userId: 'u-ann', name: 'Ann Lee', kind: 'employee' },
          { userId: 'u-drv', name: 'Dan Driver', kind: 'driver' },
        ]
      }
      if (path.startsWith('/api/v1/chat/summaries')) {
        return [
          {
            orderNum: 100,
            shipperName: 'SMITH',
            origin: 'Austin, TX',
            destination: 'Denver, CO',
            packDate: '2026-10-21',
            loadDate: null,
            deliveryDate: null,
          },
        ]
      }
      if (path.endsWith('/read')) return { lastReadAt: '2026-10-20T10:01:00.000Z' }
      return []
    }
  }

  const renderPane = () =>
    wrap(<ConversationPane orderNum={100} myUserId="me" isAdmin={false} onBack={() => {}} />)

  it('shows the header, my messages as mine, mentions of me, and the New line', async () => {
    handler = api()
    renderPane()
    expect(await screen.findByText('Truck is loaded')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('#100 · Smith'))
    expect(await screen.findByText(/Austin, TX → Denver, CO/)).toBeInTheDocument()
    expect(await screen.findByText('Drivers: Dan Driver')).toBeInTheDocument()
    expect(screen.getByText(/^You ·/)).toBeInTheDocument()
    expect(screen.getByText('@Me Myself')).toBeInTheDocument()
    // Only the message after my read cursor sits below the New line.
    const separators = screen.getAllByRole('separator').map((s) => s.textContent)
    expect(separators).toContain('New')
    // Reading advances the cursor to the newest message.
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/read') && c.init?.method === 'POST')).toBe(true),
    )
  })

  it('sends on Enter with a clientMessageId, and keeps Shift+Enter for new lines', async () => {
    handler = api()
    renderPane()
    await screen.findByText('Truck is loaded')
    const box = screen.getByLabelText('Message')
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'line one' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(calls.some((c) => c.init?.method === 'POST' && c.path.endsWith('/messages'))).toBe(false)
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('line one')
    const post = calls.find((c) => c.init?.method === 'POST' && c.path.endsWith('/messages'))
    const sent = JSON.parse(String(post?.init?.body)) as { clientMessageId: string; body: string }
    expect(sent.body).toBe('line one')
    expect(sent.clientMessageId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('turns a picked @mention into a mention token when sending', async () => {
    handler = api()
    renderPane()
    await screen.findByText('Truck is loaded')
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'ping @da', selectionStart: 8 } })
    const option = await screen.findByRole('option', { name: /Dan Driver/ })
    fireEvent.mouseDown(option)
    expect(box.value).toBe('ping @Dan Driver ')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === 'POST' && c.path.endsWith('/messages'))).toBe(
        true,
      ),
    )
    const post = calls.find((c) => c.init?.method === 'POST' && c.path.endsWith('/messages'))
    expect(JSON.parse(String(post?.init?.body)).body).toBe('ping @[Dan Driver](u-drv)')
  })

  it('marks a failed send, and retries it with the same clientMessageId', async () => {
    let attempts = 0
    handler = api({
      post: (body) => {
        attempts++
        if (attempts === 1) throw new ApiError('boom', 'INTERNAL', 500)
        return {
          ...message('m-ok', 'me', body.body, '2026-10-20T11:00:00.000Z'),
          clientMessageId: body.clientMessageId,
        }
      },
    })
    renderPane()
    await screen.findByText('Truck is loaded')
    const box = screen.getByLabelText('Message')
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: 'flaky' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const status = await screen.findByText(/Not sent/)
    fireEvent.click(within(status).getByText('Retry'))
    await waitFor(() => expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument())
    const posts = calls
      .filter((c) => c.init?.method === 'POST' && c.path.endsWith('/messages'))
      .map((c) => (JSON.parse(String(c.init?.body)) as { clientMessageId: string }).clientMessageId)
    expect(posts).toHaveLength(2)
    expect(posts[0]).toBe(posts[1])
  })

  it('explains a 403 instead of showing the thread, and disables the composer', async () => {
    handler = (path) => {
      if (path.startsWith('/api/v1/chat/rooms/')) throw new ApiError('no', 'CHAT_FORBIDDEN', 403)
      return []
    }
    renderPane()
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have access')
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })

  it('follows and mutes through the membership endpoint', async () => {
    handler = (path, init) => {
      if (path.endsWith('/membership')) return { following: false, muted: false }
      return api()(path, init)
    }
    renderPane()
    fireEvent.click(await screen.findByRole('button', { name: /Following/ }))
    await waitFor(() => {
      const put = calls.find((c) => c.path.endsWith('/membership'))
      expect(put?.init?.method).toBe('PUT')
      expect(JSON.parse(String(put?.init?.body))).toEqual({ following: false })
    })
  })
})
