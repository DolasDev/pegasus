import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@pegasus/api-http'
import type { SupportInboxThread, SupportMessage, SupportThreadDetail } from '@/api/support'

// ---------------------------------------------------------------------------
// Admin support inbox + thread page, against a fake `adminFetch`, plus the
// post-login return-to that makes the alert email's thread link land on the
// thread.
// ---------------------------------------------------------------------------

type Call = { path: string; init?: RequestInit }
let calls: Call[] = []
let handler: (path: string, init?: RequestInit) => unknown = () => []

vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@pegasus/api-http')
  return {
    ApiError,
    adminFetch: (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      try {
        return Promise.resolve(handler(path, init))
      } catch (err) {
        return Promise.reject(err)
      }
    },
  }
})

let routeId = 't1'
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: { to: string; params?: Record<string, string>; children: ReactNode } & Record<
    string,
    unknown
  >) => {
    const href = Object.entries(params ?? {}).reduce((h, [k, v]) => h.replace(`$${k}`, v), to)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  useParams: () => ({ id: routeId }),
}))

import { SupportInboxPage, formatWhen } from '@/routes/_auth/support/index'
import { SupportThreadPage } from '@/routes/_auth/support/$id'
import {
  DEFAULT_AFTER_LOGIN,
  rememberReturnTo,
  safeReturnPath,
  takeReturnTo,
} from '@/auth/return-to'

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function inboxRow(id: string, extra: Partial<SupportInboxThread> = {}): SupportInboxThread {
  return {
    id,
    subject: `Subject ${id}`,
    status: 'awaiting_operator',
    lastMessageAt: '2026-11-20T10:00:00.000Z',
    lastAuthorKind: 'customer',
    createdAt: '2026-11-20T10:00:00.000Z',
    unread: false,
    tenant: { id: 'ten-1', name: 'Acme Moving' },
    openedBy: { id: 'u-1', name: 'Ann Lee', email: 'ann@acme.example' },
    ...extra,
  }
}

function detail(extra: Partial<SupportThreadDetail> = {}): {
  thread: SupportThreadDetail
  messages: SupportMessage[]
} {
  return {
    thread: {
      ...inboxRow('t1'),
      pageUrl: 'https://app.example/driver-planning/trips/7',
      userAgent: 'Mozilla/5.0 Test',
      appVersion: null,
      ...extra,
    },
    messages: [
      {
        id: 'm1',
        clientMessageId: 'cid-m1',
        authorKind: 'customer',
        authorName: 'Ann Lee',
        body: 'Trip 7 shows the wrong day',
        createdAt: '2026-11-20T10:00:00.000Z',
      },
    ],
  }
}

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body)) as Record<string, unknown>
const writes = () => calls.filter((c) => c.init?.method === 'POST' || c.init?.method === 'PATCH')

beforeEach(() => {
  calls = []
  handler = () => []
  routeId = 't1'
  sessionStorage.clear()
})

describe('SupportInboxPage', () => {
  it('shows open threads by default, linking each to its thread', async () => {
    handler = () => [
      inboxRow('t1', { unread: true }),
      inboxRow('t2', { status: 'awaiting_customer' }),
    ]
    wrap(<SupportInboxPage />)
    expect(await screen.findByText('Subject t1')).toBeInTheDocument()
    expect(calls[0]?.path).toBe('/api/admin/support/threads?status=open')
    expect(screen.getByText('Subject t1').closest('a')).toHaveAttribute('href', '/support/t1')
    expect(screen.getAllByText(/Acme Moving · Ann Lee/)).toHaveLength(2)
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
    expect(screen.getByText('Waiting on customer')).toBeInTheDocument()
  })

  it('switches filters; All sends no status', async () => {
    wrap(<SupportInboxPage />)
    expect(await screen.findByText('Nothing here.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Resolved' }))
    await waitFor(() =>
      expect(calls.map((c) => c.path)).toContain('/api/admin/support/threads?status=resolved'),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/admin/support/threads'))
  })

  it('surfaces a load error (support off in this environment answers 404)', async () => {
    handler = () => {
      throw new ApiError('Not found', 'NOT_FOUND', 404)
    }
    wrap(<SupportInboxPage />)
    expect(await screen.findByText(/Couldn’t load the inbox: Not found/)).toBeInTheDocument()
  })

  it('formats today as a time and other days as a date', () => {
    const now = new Date('2026-11-20T15:00:00')
    expect(formatWhen('2026-11-20T09:05:00', now)).toBe('9:05 AM')
    expect(formatWhen('2026-11-02T09:05:00', now)).toBe('Nov 2')
    expect(formatWhen('bad', now)).toBe('')
  })
})

describe('SupportThreadPage', () => {
  it('shows who asked, from which page, and the conversation', async () => {
    handler = () => detail()
    wrap(<SupportThreadPage />)
    expect(await screen.findByText('Trip 7 shows the wrong day')).toBeInTheDocument()
    expect(calls[0]?.path).toBe('/api/admin/support/threads/t1')
    expect(screen.getByText('Acme Moving').closest('a')).toHaveAttribute('href', '/tenants/ten-1')
    expect(screen.getByText(/ann@acme.example/)).toBeInTheDocument()
    expect(screen.getByText('https://app.example/driver-planning/trips/7')).toBeInTheDocument()
    expect(screen.getByText('Mozilla/5.0 Test')).toBeInTheDocument()
  })

  it('replies, and a retry after a failure reuses the clientMessageId', async () => {
    let fail = true
    handler = (_path, init) => {
      if (init?.method !== 'POST') return detail()
      if (fail) throw new ApiError('Network down', 'NETWORK', 0)
      return { ...detail().messages[0], id: 'm2', authorKind: 'operator', body: 'On it' }
    }
    wrap(<SupportThreadPage />)
    const box = await screen.findByLabelText('Reply')
    fireEvent.change(box, { target: { value: '  On it ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
    const [first, second] = writes().map(bodyOf)
    expect(writes()[0]?.path).toBe('/api/admin/support/threads/t1/messages')
    expect(first).toMatchObject({ body: 'On it' })
    expect(second?.['clientMessageId']).toBe(first?.['clientMessageId'])
  })

  it('resolves an open thread and reopens a resolved one to Needs reply', async () => {
    handler = (_path, init) => (init?.method === 'PATCH' ? {} : detail())
    const first = wrap(<SupportThreadPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ path: '/api/admin/support/threads/t1' })
    expect(bodyOf(writes()[0]!)).toEqual({ status: 'resolved' })
    first.unmount()

    calls = []
    handler = (_path, init) => (init?.method === 'PATCH' ? {} : detail({ status: 'resolved' }))
    wrap(<SupportThreadPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(bodyOf(writes()[0]!)).toEqual({ status: 'awaiting_operator' })
  })

  it('says so when the thread does not exist', async () => {
    routeId = 'missing'
    handler = () => {
      throw new ApiError('Support thread not found', 'SUPPORT_THREAD_NOT_FOUND', 404)
    }
    wrap(<SupportThreadPage />)
    expect(await screen.findByText('Thread not found.')).toBeInTheDocument()
  })
})

describe('return-to after sign-in', () => {
  it('sends the user back to the page the guard bounced them from, once', () => {
    rememberReturnTo('/support/t1')
    expect(takeReturnTo()).toBe('/support/t1')
    expect(takeReturnTo()).toBe(DEFAULT_AFTER_LOGIN)
  })

  it('defaults to the tenants list', () => {
    expect(takeReturnTo()).toBe('/tenants')
    rememberReturnTo('/')
    expect(takeReturnTo()).toBe('/tenants')
  })

  it.each([
    '//evil.example/x',
    'https://evil.example',
    '/\\evil.example',
    'support',
    '/login',
    '/auth/callback?code=x',
    '',
  ])('refuses %j', (raw) => {
    expect(safeReturnPath(raw)).toBeNull()
    rememberReturnTo(raw)
    expect(takeReturnTo()).toBe('/tenants')
  })

  it('ignores a tampered stored value', () => {
    sessionStorage.setItem('pegasus_admin_return_to', '//evil.example')
    expect(takeReturnTo()).toBe('/tenants')
  })

  it('keeps the query string', () => {
    expect(safeReturnPath('/support?x=1')).toBe('/support?x=1')
  })
})
