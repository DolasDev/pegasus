import { ItineraryService } from './itineraryService'

const mockFetchPaginated = jest.fn()
const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetchPaginated: mockFetchPaginated, fetch: mockFetch })),
}))

beforeEach(() => {
  mockFetchPaginated.mockReset()
  mockFetch.mockReset()
})

describe('ItineraryService act facts', () => {
  it('PUTs an ETA (or its clearing) with the item key and its listed day', async () => {
    mockFetch.mockResolvedValue({ key: 'local-job-token:9:LOAD' })
    await ItineraryService.setEta(
      { key: 'local-job-token:9:LOAD', day: '2026-11-03' },
      { day: '2026-11-04', window: { start: '08:00', end: '10:00' } },
    )
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/me/itinerary/acts/eta', {
      method: 'PUT',
      body: JSON.stringify({
        key: 'local-job-token:9:LOAD',
        day: '2026-11-03',
        eta: { day: '2026-11-04', window: { start: '08:00', end: '10:00' } },
      }),
    })
  })

  it('PUTs done (or null to undo)', async () => {
    mockFetch.mockResolvedValue({})
    await ItineraryService.setDone({ key: 'k', day: '2026-11-03' }, null)
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/me/itinerary/acts/done', {
      method: 'PUT',
      body: JSON.stringify({ key: 'k', day: '2026-11-03', done: null }),
    })
  })
})

describe('ItineraryService.getMyItinerary', () => {
  it('calls /me/itinerary with the inclusive range and keeps the meta', async () => {
    mockFetchPaginated.mockResolvedValue({
      data: [{ key: 'longhaul-activity:7' }],
      meta: { count: 1, from: '2026-10-27', to: '2026-11-02', failedSources: ['local'] },
    })

    const res = await ItineraryService.getMyItinerary('2026-10-27', '2026-11-02')

    expect(mockFetchPaginated).toHaveBeenCalledWith(
      '/api/v1/onprem/longhaul/me/itinerary?from=2026-10-27&to=2026-11-02',
    )
    expect(res.items).toEqual([{ key: 'longhaul-activity:7' }])
    expect(res.meta.failedSources).toEqual(['local'])
  })

  it('defaults a missing meta so the screen never reads undefined', async () => {
    mockFetchPaginated.mockResolvedValue({ data: [] })

    const res = await ItineraryService.getMyItinerary('2026-10-27', '2026-10-27')

    expect(res.meta).toEqual({ count: 0, from: '2026-10-27', to: '2026-10-27', failedSources: [] })
  })

  it('propagates API errors (the screen maps DRIVER_NOT_MAPPED itself)', async () => {
    const err = Object.assign(new Error('no driver'), { code: 'DRIVER_NOT_MAPPED', status: 403 })
    mockFetchPaginated.mockRejectedValue(err)

    await expect(ItineraryService.getMyItinerary('2026-10-27', '2026-10-27')).rejects.toBe(err)
  })
})
