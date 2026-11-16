import { TaskService, snoozeUntilTomorrow } from './taskService'

const mockFetchPaginated = jest.fn()
const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetchPaginated: mockFetchPaginated, fetch: mockFetch })),
}))

beforeEach(() => {
  mockFetchPaginated.mockReset()
  mockFetch.mockReset()
})

describe('TaskService', () => {
  it("GETs the caller's tasks for the device's day and keeps meta", async () => {
    mockFetchPaginated.mockResolvedValue({
      data: [{ key: 'task:submit-bol:1:order' }],
      meta: { today: '2026-11-16', enabledRules: ['submit-bol'], hidden: 1 },
    })
    const res = await TaskService.getMyTasks('2026-11-16')
    expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/me/tasks?today=2026-11-16')
    expect(res.tasks).toHaveLength(1)
    expect(res.meta).toMatchObject({
      enabledRules: ['submit-bol'],
      hidden: 1,
      failedSources: [],
      unavailable: [],
    })
  })

  it('PUTs a snooze', async () => {
    mockFetch.mockResolvedValue({})
    await TaskService.snooze('task:submit-bol:1:order', new Date('2026-11-17T12:00:00Z'))
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/me/tasks/state', {
      method: 'PUT',
      body: JSON.stringify({
        key: 'task:submit-bol:1:order',
        snoozedUntil: '2026-11-17T12:00:00.000Z',
      }),
    })
  })

  it('snoozes until 6 am local tomorrow', () => {
    const until = snoozeUntilTomorrow(new Date(2026, 10, 16, 21, 30))
    expect([until.getDate(), until.getHours(), until.getMinutes()]).toEqual([17, 6, 0])
  })
})
