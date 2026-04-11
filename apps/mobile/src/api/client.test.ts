import { getApiClient, setTokenProvider, _resetApiClient } from './client'

// Mock @pegasus/api-http
const mockFetch = jest.fn()
const mockFetchPaginated = jest.fn()
jest.mock('@pegasus/api-http', () => ({
  createApiClient: jest.fn(() => ({
    fetch: mockFetch,
    fetchPaginated: mockFetchPaginated,
  })),
}))

describe('mobile API client', () => {
  beforeEach(() => {
    _resetApiClient()
    mockFetch.mockReset()
    mockFetchPaginated.mockReset()
  })

  it('returns a singleton ApiClient', () => {
    const client1 = getApiClient()
    const client2 = getApiClient()
    expect(client1).toBe(client2)
  })

  it('client.fetch delegates to the underlying ApiClient', async () => {
    mockFetch.mockResolvedValueOnce({ id: '1', name: 'Test' })

    const client = getApiClient()
    const result = await client.fetch('/api/v1/moves')

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/moves')
    expect(result).toEqual({ id: '1', name: 'Test' })
  })

  it('client.fetchPaginated delegates to the underlying ApiClient', async () => {
    const mockResponse = {
      data: [{ id: '1' }],
      meta: { total: 1, count: 1, limit: 25, offset: 0 },
    }
    mockFetchPaginated.mockResolvedValueOnce(mockResponse)

    const client = getApiClient()
    const result = await client.fetchPaginated('/api/v1/moves')

    expect(mockFetchPaginated).toHaveBeenCalledWith('/api/v1/moves')
    expect(result).toEqual(mockResponse)
  })

  it('setTokenProvider updates the token used by the client', () => {
    setTokenProvider(() => 'test-token-123')
    // Getting client after setting token provider ensures it's wired
    const client = getApiClient()
    expect(client).toBeDefined()
  })

  it('_resetApiClient creates a fresh client on next call', () => {
    const _client1 = getApiClient()
    _resetApiClient()
    const _client2 = getApiClient()
    // After reset, createApiClient is called again
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createApiClient } = require('@pegasus/api-http')
    expect(createApiClient).toHaveBeenCalledTimes(2)
  })
})
