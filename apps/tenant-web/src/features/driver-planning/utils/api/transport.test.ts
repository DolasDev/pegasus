// ---------------------------------------------------------------------------
// Unit tests for transport.ts.
//
// transport.ts is a one-line re-export of fetchData from http-client.
// We verify both that the export exists and that calls pass through to
// the underlying apiFetch (i.e., transport.fetchData is the same function).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@pegasus/api-http')
  return {
    apiFetch: vi.fn(),
    ApiError,
  }
})

import { apiFetch } from '@/api/client'
import { fetchData as fetchDataFromTransport } from './transport'
import { fetchData as fetchDataFromHttpClient } from './http-client'

const mockApiFetch = vi.mocked(apiFetch)

describe('longhaul transport', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('re-exports fetchData (same function reference as http-client)', () => {
    expect(fetchDataFromTransport).toBe(fetchDataFromHttpClient)
  })

  it('exposes fetchData as a function', () => {
    expect(typeof fetchDataFromTransport).toBe('function')
  })

  it('routes a GET call through to apiFetch with onprem/longhaul prefix', async () => {
    mockApiFetch.mockResolvedValueOnce([])
    const result = await fetchDataFromTransport('fetchStates')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/onprem/longhaul/states',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result).toEqual({ status: 200, data: [], error: undefined })
  })

  it('routes a POST call through to apiFetch with serialized body', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'new' })
    const trip = { customer: 'X' }
    const result = await fetchDataFromTransport('saveTrip', trip)
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/onprem/longhaul/trips',
      { method: 'POST', body: JSON.stringify(trip) },
    )
    expect(result).toEqual({ status: 200, data: { id: 'new' }, error: undefined })
  })
})
