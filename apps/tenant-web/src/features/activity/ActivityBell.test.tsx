// The header bell against a fake API behind apiFetch / apiFetchPaginated, with
// a real QueryClient so the query + mutation wiring is exercised.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const fetchMock = vi.fn()
const pageMock = vi.fn()
vi.mock('@/api/client', () => ({
  apiFetch: (...a: unknown[]) => fetchMock(...a),
  apiFetchPaginated: (...a: unknown[]) => pageMock(...a),
}))

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

import { ActivityBell } from './ActivityBell'
import { activityLink } from './link'

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ActivityBell />
    </QueryClientProvider>,
  )
}

const ITEM = {
  id: 'n1',
  type: 'task.blocked',
  title: 'Sam is blocked on #500',
  body: 'Mark Pack done: Customer not home',
  data: { type: 'task.blocked', orderNum: '500', taskKey: 'task:x:500:y' },
  entityType: 'order',
  entityId: '500',
  groupKey: 'order:500',
  actorName: 'Sam',
  createdAt: new Date().toISOString(),
  seenAt: null,
  readAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async (path: string) =>
    path.endsWith('/unseen-count') ? { unseen: 3 } : {},
  )
  pageMock.mockResolvedValue({ data: [ITEM], meta: {} })
})

describe('ActivityBell', () => {
  it('shows the unseen count without loading the list', async () => {
    renderBell()
    expect(await screen.findByTestId('activity-unseen')).toHaveTextContent('3')
    expect(pageMock).not.toHaveBeenCalled()
  })

  it('opens the panel, clears the bell, and opens an item where it belongs', async () => {
    renderBell()
    await screen.findByTestId('activity-unseen')
    fireEvent.click(screen.getByTestId('activity-bell'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/me/activity/seen', { method: 'POST' }),
    )
    fireEvent.click(await screen.findByTestId('activity-item-n1'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/me/activity/n1/read', { method: 'POST' }),
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/messages/shipment/$orderNum',
      params: { orderNum: '500' },
    })
  })

  it('marks everything read', async () => {
    renderBell()
    fireEvent.click(screen.getByTestId('activity-bell'))
    fireEvent.click(await screen.findByText('Mark all read'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/me/activity/read-all', { method: 'POST' }),
    )
  })
})

describe('activityLink', () => {
  it('maps the same data payloads the mobile app routes on', () => {
    expect(activityLink({ type: 'chat.message', orderNum: '42' })).toEqual({
      to: '/messages/shipment/$orderNum',
      params: { orderNum: '42' },
    })
    expect(activityLink({ type: 'trip.assigned', tripId: 7 })).toEqual({
      to: '/driver-planning/trips/$tripId',
      params: { tripId: '7' },
    })
    expect(activityLink({ type: 'workflow.message' })).toBeNull()
    expect(activityLink({ type: 'move.assigned', moveId: 'm' })).toBeNull()
    expect(activityLink(null)).toBeNull()
  })
})
