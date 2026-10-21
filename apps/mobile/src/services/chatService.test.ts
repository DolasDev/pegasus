import { ChatService } from './chatService'

const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch })),
}))

beforeEach(() => mockFetch.mockReset())

describe('ChatService', () => {
  it('reads the inbox as the rooms the driver follows', async () => {
    mockFetch.mockResolvedValue(null)
    expect(await ChatService.getInbox()).toEqual([])
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/chat/inbox?filter=following')
  })

  it('pages messages forward and back with the cursor in the query', async () => {
    mockFetch.mockResolvedValue([])
    await ChatService.getMessages(4242, { after: 'm-9', limit: 100 })
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/v1/chat/rooms/shipment/4242/messages?after=m-9&limit=100',
    )
    await ChatService.getMessages(4242)
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/chat/rooms/shipment/4242/messages')
  })

  it('posts with the clientMessageId the API dedupes on', async () => {
    mockFetch.mockResolvedValue({ id: 'm-1' })
    await ChatService.postMessage(4242, { clientMessageId: 'cid-12345', body: 'On my way' })
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/chat/rooms/shipment/4242/messages', {
      method: 'POST',
      body: JSON.stringify({ clientMessageId: 'cid-12345', body: 'On my way' }),
    })
  })

  it('marks read, deletes and sets membership on the right routes', async () => {
    mockFetch.mockResolvedValue({})
    await ChatService.markRead(7, '2026-10-20T10:00:00.000Z')
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/chat/rooms/shipment/7/read', {
      method: 'POST',
      body: JSON.stringify({ at: '2026-10-20T10:00:00.000Z' }),
    })
    await ChatService.deleteMessage('m/1')
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/chat/messages/m%2F1', { method: 'DELETE' })
    await ChatService.setMembership(7, { muted: true })
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/chat/rooms/shipment/7/membership', {
      method: 'PUT',
      body: JSON.stringify({ muted: true }),
    })
  })

  it('asks for summaries once per distinct order, capped at the API batch of 100', async () => {
    mockFetch.mockResolvedValue([])
    expect(await ChatService.getSummaries([])).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()

    await ChatService.getSummaries([3, 1, 3])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/chat/summaries?entityType=shipment&ids=3,1')

    await ChatService.getSummaries(Array.from({ length: 150 }, (_, i) => i + 1))
    const url = mockFetch.mock.calls.at(-1)?.[0] as string
    expect(url.split('ids=')[1]?.split(',')).toHaveLength(100)
  })

  it('reads my user id from /me/driver, null when the API predates it', async () => {
    mockFetch.mockResolvedValueOnce({ longhaulDriverId: 5, userId: 'u-1' })
    expect(await ChatService.getMyUserId()).toBe('u-1')
    mockFetch.mockResolvedValueOnce({ longhaulDriverId: 5 })
    expect(await ChatService.getMyUserId()).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/me/driver')
  })
})
