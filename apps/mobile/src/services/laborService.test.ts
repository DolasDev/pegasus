import { LaborService } from './laborService'

const mockFetch = jest.fn()
const mockFetchPaginated = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch, fetchPaginated: mockFetchPaginated })),
}))

const PHONE = '+14045550101'
const ENC = encodeURIComponent(PHONE)

describe('LaborService', () => {
  it('lists A–Z with no query, and keeps the search location from meta', async () => {
    mockFetchPaginated.mockResolvedValueOnce({ data: [{ phone: PHONE }], meta: { location: null } })
    const res = await LaborService.searchCrews('  ')
    expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/labor/crews', undefined)
    expect(res).toEqual({ crews: [{ phone: PHONE }], location: null, locationNotFound: false })

    const location = { lat: 32.8, lon: -83.6, label: '31201 (GA)' }
    mockFetchPaginated.mockResolvedValueOnce({ data: [], meta: { location } })
    expect((await LaborService.searchCrews('31201')).location).toEqual(location)
    expect(mockFetchPaginated).toHaveBeenLastCalledWith('/api/v1/labor/crews?q=31201', undefined)
  })

  it('reports an unknown location', async () => {
    mockFetchPaginated.mockResolvedValueOnce({
      data: [],
      meta: { location: null, locationNotFound: true },
    })
    expect((await LaborService.searchCrews('Nowhere, GA')).locationNotFound).toBe(true)
    expect(mockFetchPaginated).toHaveBeenLastCalledWith(
      '/api/v1/labor/crews?q=Nowhere%2C%20GA',
      undefined,
    )
  })

  it('adds a crew and returns the outcome', async () => {
    mockFetchPaginated.mockResolvedValueOnce({
      data: { phone: PHONE },
      meta: { outcome: 'linkedExisting' },
    })
    const res = await LaborService.addCrew({ phone: '404-555-0101', name: 'Ace' })
    expect(res).toEqual({ crew: { phone: PHONE }, outcome: 'linkedExisting' })
    const [path, init] = mockFetchPaginated.mock.calls[0]
    expect(path).toBe('/api/v1/labor/crews')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ phone: '404-555-0101', name: 'Ace' })
  })

  it('addresses a crew by its URL-encoded phone', async () => {
    mockFetch.mockResolvedValue({})
    await LaborService.getCrew(PHONE)
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}`)

    await LaborService.updateCrew(PHONE, { nickname: 'Ace' })
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}`, {
      method: 'PATCH',
      body: JSON.stringify({ nickname: 'Ace' }),
    })

    await LaborService.removeCrew(PHONE)
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}`, { method: 'DELETE' })
  })

  it('sends service areas, packers and ratings to their sub-resources', async () => {
    mockFetch.mockResolvedValue({})
    await LaborService.setServiceAreas(PHONE, [{ city: 'Macon', region: 'GA' }])
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}/service-areas`, {
      method: 'PUT',
      body: JSON.stringify({ serviceAreas: [{ city: 'Macon', region: 'GA' }] }),
    })

    await LaborService.addPacker(PHONE, { firstName: 'A', lastName: 'B', phone: '4045550199' })
    expect(mockFetch.mock.lastCall[0]).toBe(`/api/v1/labor/crews/${ENC}/packers`)
    expect(mockFetch.mock.lastCall[1].method).toBe('POST')

    await LaborService.updatePacker(PHONE, 'p 1', { email: null })
    expect(mockFetch.mock.lastCall[0]).toBe(`/api/v1/labor/crews/${ENC}/packers/p%201`)
    expect(mockFetch.mock.lastCall[1]).toEqual({
      method: 'PATCH',
      body: JSON.stringify({ email: null }),
    })

    await LaborService.deletePacker(PHONE, 'p1')
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}/packers/p1`, {
      method: 'DELETE',
    })

    await LaborService.rateCrew(PHONE, { stars: 4, comment: 'good' })
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ stars: 4, comment: 'good' }),
    })

    await LaborService.clearRating(PHONE)
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/v1/labor/crews/${ENC}/rating`, {
      method: 'DELETE',
    })
  })

  it('batches an import', async () => {
    mockFetch.mockResolvedValueOnce([{ phone: PHONE, outcome: 'added' }])
    const rows = [{ phone: PHONE, name: 'Ace', email: null }]
    expect(await LaborService.importCrews(rows)).toEqual([{ phone: PHONE, outcome: 'added' }])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/crews/import', {
      method: 'POST',
      body: JSON.stringify({ crews: rows }),
    })
  })

  it('skips the place lookup under two letters', async () => {
    expect(await LaborService.searchPlaces(' m ')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()

    mockFetch.mockResolvedValueOnce(null)
    expect(await LaborService.searchPlaces('mac, ga')).toEqual([])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/places?q=mac%2C%20ga')
  })

  it('fetches the export rows', async () => {
    mockFetch.mockResolvedValueOnce(null)
    expect(await LaborService.getExport()).toEqual([])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/export')
  })
})
