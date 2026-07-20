// ---------------------------------------------------------------------------
// Unit tests for the longhaul HTTP client.
//
// Wraps existing behavior so we can refactor the longhaul SPA safely.
// The http-client:
//   1. Resolves routeName -> { method, path, body? } via resolveRoute
//   2. Prefixes path with /api/v1/onprem/longhaul
//   3. Calls apiFetch and returns a legacy envelope { status, data, error }
//   4. Catches throws from apiFetch and reshapes into error envelope
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/client', async () => {
  const { ApiError } = await import('@pegasus/api-http')
  return {
    apiFetch: vi.fn(),
    ApiError,
  }
})

import { apiFetch, ApiError } from '@/api/client'
import { fetchData } from './http-client'

const mockApiFetch = vi.mocked(apiFetch)

describe('longhaul http-client: fetchData', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  describe('path prefixing', () => {
    it('prefixes /api/v1/onprem/longhaul before resolved path (simple GET)', async () => {
      mockApiFetch.mockResolvedValueOnce([])
      await fetchData('fetchStates')
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/onprem/longhaul/states',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('prefixes onprem/longhaul before parametrized GET', async () => {
      mockApiFetch.mockResolvedValueOnce({ id: 7 })
      await fetchData('fetchTrip', 7)
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/onprem/longhaul/trips/7',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('preserves query strings produced by resolveRoute', async () => {
      mockApiFetch.mockResolvedValueOnce([])
      const filters = { status: 'open' }
      await fetchData('fetchTrips', filters)
      const expectedQs = `?filters=${encodeURIComponent(JSON.stringify(filters))}`
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/v1/onprem/longhaul/trips${expectedQs}`,
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('method/body forwarding', () => {
    it('forwards GET with no body', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('fetchUser')
      const [, init] = mockApiFetch.mock.calls[0]
      expect(init).toEqual({ method: 'GET' })
      expect((init as any).body).toBeUndefined()
    })

    it('forwards POST and serializes body via JSON.stringify', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: true })
      const trip = { customer: 'Acme' }
      await fetchData('saveTrip', trip)
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/trips', {
        method: 'POST',
        body: JSON.stringify(trip),
      })
    })

    it('forwards PUT for routes with id (saveTrip update branch)', async () => {
      mockApiFetch.mockResolvedValueOnce({ id: 1 })
      const trip = { id: 1, customer: 'Acme' }
      await fetchData('saveTrip', trip)
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/trips/1', {
        method: 'PUT',
        body: JSON.stringify(trip),
      })
    })

    it('forwards PATCH with serialized body', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('changeTripStatus', { tripId: 4, statusId: 2, status: 'open' })
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/trips/4/status', {
        method: 'PATCH',
        body: JSON.stringify({ statusId: 2, status: 'open' }),
      })
    })

    it('forwards DELETE with no body', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('deleteShipmentFilter', 'filter-1')
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/onprem/longhaul/shipment-filters/filter-1',
        { method: 'DELETE' },
      )
    })

    it('omits the body key entirely when resolveRoute returns no body', async () => {
      mockApiFetch.mockResolvedValueOnce(null)
      await fetchData('fetchVersion')
      const [, init] = mockApiFetch.mock.calls[0]
      expect(Object.prototype.hasOwnProperty.call(init, 'body')).toBe(false)
    })

    it('includes body key even when body is empty object', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('updateTripSummaryInfo', 99)
      const [, init] = mockApiFetch.mock.calls[0]
      expect((init as any).body).toBe(JSON.stringify({}))
    })
  })

  describe('success envelope', () => {
    it('wraps successful response as { status: 200, data, error: undefined }', async () => {
      const payload = { hello: 'world' }
      mockApiFetch.mockResolvedValueOnce(payload)
      const result = await fetchData('fetchStates')
      expect(result).toEqual({ status: 200, data: payload, error: undefined })
    })

    it('wraps array payload as data', async () => {
      const payload = [{ id: 1 }, { id: 2 }]
      mockApiFetch.mockResolvedValueOnce(payload)
      const result = await fetchData('fetchDrivers')
      expect(result).toEqual({ status: 200, data: payload, error: undefined })
    })

    it('wraps null payload as data', async () => {
      mockApiFetch.mockResolvedValueOnce(null)
      const result = await fetchData('fetchVersion')
      expect(result).toEqual({ status: 200, data: null, error: undefined })
    })
  })

  describe('error envelope', () => {
    it('reshapes ApiError using its status, message, and code', async () => {
      mockApiFetch.mockRejectedValueOnce(new ApiError('Not found', 'not_found', 404))
      const result = await fetchData('fetchTrip', 999)
      expect(result).toEqual({
        status: 404,
        data: undefined,
        error: { message: 'Not found', code: 'not_found' },
      })
    })

    it('reshapes 500-class ApiError', async () => {
      mockApiFetch.mockRejectedValueOnce(new ApiError('Boom', 'internal', 500))
      const result = await fetchData('fetchStates')
      expect(result).toEqual({
        status: 500,
        data: undefined,
        error: { message: 'Boom', code: 'internal' },
      })
    })

    it('reshapes a non-ApiError Error using status 0 and message only', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network down'))
      const result = await fetchData('fetchStates')
      expect(result).toEqual({
        status: 0,
        data: undefined,
        error: { message: 'Network down' },
      })
    })

    it('reshapes a thrown non-Error value via String() coercion', async () => {
      mockApiFetch.mockRejectedValueOnce('something weird')
      const result = await fetchData('fetchStates')
      expect(result).toEqual({
        status: 0,
        data: undefined,
        error: { message: 'something weird' },
      })
    })

    it('reshapes a thrown non-Error object via String() coercion', async () => {
      mockApiFetch.mockRejectedValueOnce({ kind: 'oops' })
      const result = await fetchData('fetchStates')
      expect((result as any).status).toBe(0)
      expect((result as any).data).toBeUndefined()
      // String({...}) -> "[object Object]"
      expect((result as any).error.message).toBe('[object Object]')
    })
  })

  describe('unknown route', () => {
    it('lets resolveRoute throws bubble up (not caught by try/catch)', async () => {
      // resolveRoute throws synchronously *outside* the try block, so the
      // promise rejects rather than returning an error envelope.
      await expect(fetchData('not-a-real-route')).rejects.toThrow(
        /Unknown longhaul route: not-a-real-route/,
      )
      expect(mockApiFetch).not.toHaveBeenCalled()
    })
  })

  describe('auth/header behavior', () => {
    it('does not set headers itself on a GET (delegates auth entirely to apiFetch)', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('fetchUser')
      const [, init] = mockApiFetch.mock.calls[0]
      // The Cognito JWT is attached by apiFetch via createApiClient(getToken),
      // not by this module. http-client only passes method (and body when present).
      expect(Object.keys(init as object).sort()).toEqual(['method'])
    })

    it('does not set headers itself on a POST with body', async () => {
      mockApiFetch.mockResolvedValueOnce({})
      await fetchData('saveTrip', { customer: 'Acme' })
      const [, init] = mockApiFetch.mock.calls[0]
      expect(Object.keys(init as object).sort()).toEqual(['body', 'method'])
      expect((init as RequestInit).headers).toBeUndefined()
    })
  })
})
