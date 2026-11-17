import { ActivityService } from './activityService'

const mockFetchPaginated = jest.fn()
const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetchPaginated: mockFetchPaginated, fetch: mockFetch })),
}))

beforeEach(() => {
  mockFetchPaginated.mockReset()
  mockFetch.mockReset()
})

describe('ActivityService', () => {
  it('lists a page and keeps the cursor and unseen count', async () => {
    mockFetchPaginated.mockResolvedValue({
      data: [{ id: 'n1' }],
      meta: { nextCursor: 'n1', unseen: 4 },
    })
    const page = await ActivityService.list({ cursor: 'n0', filter: 'unread' })
    expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/me/activity?filter=unread&cursor=n0')
    expect(page).toEqual({ items: [{ id: 'n1' }], nextCursor: 'n1', unseen: 4 })
  })

  it('reads the unseen count and posts seen / read / read-all', async () => {
    mockFetch.mockResolvedValue({ unseen: 2 })
    expect(await ActivityService.unseenCount()).toBe(2)
    await ActivityService.markSeen()
    await ActivityService.markRead('n1')
    await ActivityService.markAllRead()
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/me/activity/unseen-count',
      '/api/v1/me/activity/seen',
      '/api/v1/me/activity/n1/read',
      '/api/v1/me/activity/read-all',
    ])
  })

  it('PUTs a channel preference', async () => {
    mockFetch.mockResolvedValue([])
    await ActivityService.setPreference('chat.mention', 'feed')
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/me/notification-preferences', {
      method: 'PUT',
      body: JSON.stringify({ type: 'chat.mention', channel: 'feed' }),
    })
  })
})
