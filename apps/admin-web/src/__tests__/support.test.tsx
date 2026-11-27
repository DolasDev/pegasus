import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@pegasus/api-http'
import type {
  SupportDraft,
  SupportInboxThread,
  SupportMessage,
  SupportThreadDetail,
  SupportTriage,
} from '@/api/support'

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

function draft(extra: Partial<SupportDraft> = {}): SupportDraft {
  return {
    id: 'd1',
    status: 'ready',
    kind: 'bug',
    severity: 'medium',
    title: 'Trip 7 shows the wrong load day',
    summary: 'After editing the load date, trip 7 shows Tuesday.',
    reproSteps: '1. Open trip 7',
    expected: 'Monday',
    actual: 'Tuesday',
    suggestedReply: 'Thanks, I am looking into trip 7 now.',
    requestedBy: 'auto',
    modelId: 'kimi',
    error: null,
    createdAt: '2026-11-20T10:01:00.000Z',
    stale: false,
    ...extra,
  }
}

const withTriage = (triage: SupportTriage) => ({ ...detail(), triage })

describe('SupportThreadPage — AI draft (Phase 2a)', () => {
  it('shows nothing where triage is off', async () => {
    handler = () => withTriage({ enabled: false, draft: null })
    wrap(<SupportThreadPage />)
    await screen.findByText('Trip 7 shows the wrong day')
    expect(screen.queryByRole('region', { name: 'AI draft' })).not.toBeInTheDocument()
  })

  it('shows a ready draft; "Use as reply" fills the reply box without sending', async () => {
    handler = () => withTriage({ enabled: true, draft: draft() })
    wrap(<SupportThreadPage />)
    expect(await screen.findByText('Trip 7 shows the wrong load day')).toBeInTheDocument()
    expect(screen.getByText('Bug')).toBeInTheDocument()
    expect(screen.getByText('Only you see this.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use as reply' }))
    expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe(
      'Thanks, I am looking into trip 7 now.',
    )
    expect(writes()).toHaveLength(0)
  })

  it('"Use as reply" appends to what the operator already typed instead of replacing it', async () => {
    handler = () => withTriage({ enabled: true, draft: draft() })
    wrap(<SupportThreadPage />)
    const box = (await screen.findByLabelText('Reply')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Hi Ann,' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Use as reply' }))
    expect(box.value).toBe('Hi Ann,\n\nThanks, I am looking into trip 7 now.')
  })

  it('warns when the draft predates newer messages, and re-drafts on request', async () => {
    handler = (path, init) =>
      init?.method === 'POST'
        ? draft({ id: 'd2', status: 'pending' })
        : withTriage({ enabled: true, draft: draft({ stale: true }) })
    wrap(<SupportThreadPage />)
    expect(await screen.findByText(/New messages arrived after this draft/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Re-draft' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]?.path).toBe('/api/admin/support/threads/t1/drafts')
  })

  it('says it is drafting while the draft is in flight', async () => {
    handler = () => withTriage({ enabled: true, draft: draft({ status: 'running', title: null }) })
    wrap(<SupportThreadPage />)
    expect(await screen.findByText(/Drafting…/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use as reply' })).not.toBeInTheDocument()
  })

  it('shows a failed draft with its error and lets the operator try again', async () => {
    handler = (_path, init) =>
      init?.method === 'POST'
        ? draft({ status: 'pending' })
        : withTriage({
            enabled: true,
            draft: draft({ status: 'failed', error: 'model timed out' }),
          })
    wrap(<SupportThreadPage />)
    expect(await screen.findByText(/The draft failed: model timed out/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
  })

  it('offers "Draft with AI" when there is none, or after a dismiss', async () => {
    handler = () => withTriage({ enabled: true, draft: draft({ status: 'dismissed' }) })
    wrap(<SupportThreadPage />)
    expect(await screen.findByRole('button', { name: 'Draft with AI' })).toBeInTheDocument()
  })

  it('dismisses a draft', async () => {
    handler = (_path, init) =>
      init?.method === 'POST'
        ? draft({ status: 'dismissed' })
        : withTriage({ enabled: true, draft: draft() })
    wrap(<SupportThreadPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]?.path).toBe('/api/admin/support/threads/t1/drafts/d1/dismiss')
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
