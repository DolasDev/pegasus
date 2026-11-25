// ---------------------------------------------------------------------------
// Help (support channel) — the list, the new-request form and the open thread,
// against a fake API behind `apiFetch` with a real QueryClient.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '@pegasus/api-http'
import type { SupportMessage, SupportThread } from '@/api/queries/support'

type Call = { path: string; init?: RequestInit }
let calls: Call[] = []
let handler: (path: string, init?: RequestInit) => unknown = () => []

vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@pegasus/api-http')
  return {
    ApiError,
    apiFetch: (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      try {
        return Promise.resolve(handler(path, init))
      } catch (err) {
        return Promise.reject(err)
      }
    },
  }
})

import { ThreadList } from './components/ThreadList'
import { NewThreadForm } from './components/NewThreadForm'
import { ThreadPane } from './components/ThreadPane'
import { useSupportUnreadCount } from './components/SupportUnreadBadge'
import { isSupportPath, rememberPage, resetRememberedPage, supportContext } from './context'
import { formatSupportTime, statusLabel } from './format'
import { supportKeys } from '@/api/queries/support'

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrap(ui: ReactNode, qc = client()) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) }
}

function thread(id: string, extra: Partial<SupportThread> = {}): SupportThread {
  return {
    id,
    subject: `Subject ${id}`,
    status: 'awaiting_operator',
    lastMessageAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-20T10:00:00.000Z',
    unread: false,
    pageUrl: null,
    ...extra,
  }
}

function msg(id: string, authorKind: 'customer' | 'operator', body: string): SupportMessage {
  return {
    id,
    clientMessageId: `cid-${id}`,
    authorKind,
    authorName: authorKind === 'operator' ? 'Pegasus support' : 'Ann Lee',
    body,
    createdAt: '2026-11-20T10:00:00.000Z',
  }
}

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body)) as Record<string, unknown>
const posts = () => calls.filter((c) => c.init?.method === 'POST')

beforeEach(() => {
  calls = []
  handler = () => []
  resetRememberedPage()
})

describe('context', () => {
  it('attaches the last page that was not a support page', () => {
    rememberPage('https://app.example/driver-planning/trips/7')
    rememberPage('https://app.example/support')
    rememberPage('https://app.example/support/th-1')
    expect(supportContext().pageUrl).toBe('https://app.example/driver-planning/trips/7')
  })

  it('falls back to the current page, and always sends the user agent', () => {
    const ctx = supportContext()
    expect(ctx.pageUrl).toBe(window.location.href)
    expect(ctx.userAgent).toBe(navigator.userAgent)
  })

  it('never attaches sign-in or public token pages', () => {
    rememberPage('https://app.example/dispatch')
    rememberPage('https://app.example/login/callback?code=secret&state=s')
    rememberPage('https://app.example/login')
    rememberPage('https://app.example/c/crew-token')
    rememberPage('https://app.example/f/form-token')
    rememberPage('https://app.example/landing')
    expect(supportContext().pageUrl).toBe('https://app.example/dispatch')
  })

  it('treats only /support and its children as support pages', () => {
    expect(isSupportPath('/support')).toBe(true)
    expect(isSupportPath('/support/abc')).toBe(true)
    expect(isSupportPath('/supportive')).toBe(false)
    rememberPage('not a url')
    expect(supportContext().pageUrl).toBe(window.location.href)
  })
})

describe('format', () => {
  it('labels every status from the customer side', () => {
    expect(statusLabel('awaiting_operator')).toBe('Waiting for support')
    expect(statusLabel('awaiting_customer')).toBe('Support replied')
    expect(statusLabel('resolved')).toBe('Resolved')
  })

  it('shows a clock time today and a date otherwise', () => {
    const now = new Date('2026-11-20T15:00:00')
    expect(formatSupportTime('2026-11-20T09:05:00', now)).toMatch(/9:05/)
    expect(formatSupportTime('2026-11-02T09:05:00', now)).toMatch(/2/)
    expect(formatSupportTime('nope', now)).toBe('')
  })
})

describe('ThreadList', () => {
  it('lists my requests with their status and opens one', async () => {
    handler = () => [thread('a', { unread: true, status: 'awaiting_customer' }), thread('b')]
    const onOpen = vi.fn()
    wrap(<ThreadList selected={null} onOpen={onOpen} onNew={vi.fn()} />)
    expect(await screen.findByText('Subject a')).toBeInTheDocument()
    expect(screen.getByText('Support replied')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
    fireEvent.click(screen.getByText('Subject b'))
    expect(onOpen).toHaveBeenCalledWith('b')
    expect(calls[0]?.path).toBe('/api/v1/support/threads')
  })

  it('shows an empty state and the New request button', async () => {
    const onNew = vi.fn()
    wrap(<ThreadList selected={null} onOpen={vi.fn()} onNew={onNew} />)
    expect(await screen.findByText(/No requests yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /New request/ }))
    expect(onNew).toHaveBeenCalled()
  })

  it('says so when the list fails to load (flag off answers 404)', async () => {
    handler = () => {
      throw new ApiError('Not found', 'NOT_FOUND', 404)
    }
    wrap(<ThreadList selected={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(await screen.findByText(/Couldn’t load your requests/)).toBeInTheDocument()
  })
})

describe('NewThreadForm', () => {
  function fill(subject: string, body: string) {
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } })
    fireEvent.change(screen.getByLabelText('What’s going on?'), { target: { value: body } })
  }

  it('requires a subject as well as a message', () => {
    wrap(<NewThreadForm onCreated={vi.fn()} />)
    const send = screen.getByRole('button', { name: 'Send' })
    fill('', 'Trip 7 shows Tuesday')
    expect(send).toBeDisabled()
    fill('Wrong day', 'Trip 7 shows Tuesday')
    expect(send).not.toBeDisabled()
  })

  it('opens the thread with the page context and hands back its id', async () => {
    rememberPage('https://app.example/driver-planning/trips/7')
    handler = (path, init) =>
      init?.method === 'POST'
        ? { thread: thread('new-1'), message: msg('m1', 'customer', 'x') }
        : []
    const onCreated = vi.fn()
    wrap(<NewThreadForm onCreated={onCreated} />)
    fill('  Wrong day ', ' Trip 7 shows Tuesday ')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-1'))
    const sent = bodyOf(posts()[0]!)
    expect(posts()[0]!.path).toBe('/api/v1/support/threads')
    expect(sent).toMatchObject({
      subject: 'Wrong day',
      body: 'Trip 7 shows Tuesday',
      context: { pageUrl: 'https://app.example/driver-planning/trips/7' },
    })
    expect(typeof sent['clientMessageId']).toBe('string')
  })

  it('retries a failed send with the SAME clientMessageId, so it cannot open two threads', async () => {
    let fail = true
    handler = (_path, init) => {
      if (init?.method !== 'POST') return []
      if (fail) throw new ApiError('Network down', 'NETWORK', 0)
      return { thread: thread('new-2'), message: null }
    }
    const onCreated = vi.fn()
    wrap(<NewThreadForm onCreated={onCreated} />)
    fill('Wrong day', 'Trip 7')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-2'))
    const [first, second] = posts().map(bodyOf)
    expect(second?.['clientMessageId']).toBe(first?.['clientMessageId'])
  })
})

describe('ThreadPane', () => {
  const detail = (status: SupportThread['status'] = 'awaiting_customer') => ({
    thread: thread('t1', { status }),
    messages: [msg('m1', 'customer', 'Trip 7 is wrong'), msg('m2', 'operator', 'Looking now')],
  })

  it('shows the conversation and clears the thread’s unread flag in the cached list', async () => {
    handler = () => detail()
    const qc = client()
    qc.setQueryData(supportKeys.threads(), [
      thread('t1', { unread: true }),
      thread('t2', { unread: true }),
    ])
    wrap(<ThreadPane threadId="t1" onBack={vi.fn()} />, qc)
    expect(await screen.findByText('Looking now')).toBeInTheDocument()
    expect(screen.getByText(/^You ·/)).toBeInTheDocument()
    expect(screen.getByText(/^Pegasus support ·/)).toBeInTheDocument()
    await waitFor(() =>
      expect(qc.getQueryData<SupportThread[]>(supportKeys.threads())?.map((t) => t.unread)).toEqual(
        [false, true],
      ),
    )
  })

  it('sends a reply on Enter and refreshes the thread', async () => {
    handler = (_path, init) =>
      init?.method === 'POST' ? msg('m3', 'customer', 'Thanks') : detail()
    wrap(<ThreadPane threadId="t1" onBack={vi.fn()} />)
    const box = await screen.findByLabelText('Reply')
    fireEvent.change(box, { target: { value: 'Thanks' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]!.path).toBe('/api/v1/support/threads/t1/messages')
    expect(bodyOf(posts()[0]!)).toMatchObject({ body: 'Thanks' })
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
  })

  it('tells the user a resolved thread reopens when they write', async () => {
    handler = () => detail('resolved')
    wrap(<ThreadPane threadId="t1" onBack={vi.fn()} />)
    expect(await screen.findByText(/Writing again reopens it/)).toBeInTheDocument()
  })

  it('answers someone else’s (or a missing) thread with a plain message', async () => {
    handler = () => {
      throw new ApiError('Support thread not found', 'SUPPORT_THREAD_NOT_FOUND', 404)
    }
    wrap(<ThreadPane threadId="nope" onBack={vi.fn()} />)
    expect(await screen.findByText(/doesn’t exist or isn’t yours/)).toBeInTheDocument()
  })
})

describe('useSupportUnreadCount', () => {
  function Probe() {
    return <span data-testid="n">{useSupportUnreadCount()}</span>
  }

  it('counts the threads with an unread reply', async () => {
    handler = () => [thread('a', { unread: true }), thread('b'), thread('c', { unread: true })]
    wrap(<Probe />)
    await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('2'))
  })
})
