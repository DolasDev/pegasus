import { ItineraryService } from './itineraryService'

const mockFetchPaginated = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetchPaginated: mockFetchPaginated })),
}))

beforeEach(() => mockFetchPaginated.mockReset())

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
