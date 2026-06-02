// ---------------------------------------------------------------------------
// driver-planning query/mutation hook tests
//
// Covers:
//   - driverPlanningQueryOptions: queryKey shape, queryFn URL, response parsing.
//   - useUpdateConfirmedAvailability: PATCH path/body, query invalidation on
//     success, error surfacing.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'

// Mock the apiFetch client BEFORE importing the SUT.
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/api/client'
import {
  driverPlanningKeys,
  driverPlanningQueryOptions,
  useUpdateConfirmedAvailability,
  type DriverPlanningRow,
} from './driver-planning'

const mockedApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return { queryClient, Wrapper }
}

beforeEach(() => {
  mockedApiFetch.mockReset()
})

describe('driverPlanningKeys', () => {
  it('exposes a stable "all" root', () => {
    expect(driverPlanningKeys.all).toEqual(['driver-planning'])
  })

  it('list() extends the root key', () => {
    expect(driverPlanningKeys.list()).toEqual(['driver-planning', 'list'])
  })
})

describe('driverPlanningQueryOptions', () => {
  it('uses the list() queryKey', () => {
    expect(driverPlanningQueryOptions.queryKey).toEqual(['driver-planning', 'list'])
  })

  it('has a defined queryFn', () => {
    expect(typeof driverPlanningQueryOptions.queryFn).toBe('function')
  })

  it('queryFn calls apiFetch with the correct URL and returns the parsed body', async () => {
    const rows: DriverPlanningRow[] = [
      {
        driverId: 1,
        driverName: 'Alice',
        agentCode: 'A1',
        currentTripId: 100,
        currentTripTitle: 'Trip 100',
        estimatedAvailableDate: '2026-05-10',
        estimatedAvailableLocation: 'Atlanta, GA',
        confirmedAvailableDate: null,
        confirmedAvailableLocation: null,
        confirmedNotes: null,
        canada: false,
        california: false,
        rating: null,
        equipment: null,
        homeCity: null,
        homeState: null,
        deliveries: [
          {
            activityId: 999,
            plannedStart: '2026-05-08',
            plannedEnd: '2026-05-10',
            estimatedDate: '2026-05-10',
            actualDate: null,
            isCommitted: true,
            isConfirmed: false,
            city: 'ATLANTA',
            state: 'GA',
          },
        ],
        shipments: [],
      },
    ]
    mockedApiFetch.mockResolvedValueOnce(rows)

    const queryFn = driverPlanningQueryOptions.queryFn as () => Promise<DriverPlanningRow[]>
    const result = await queryFn()

    expect(mockedApiFetch).toHaveBeenCalledTimes(1)
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/driver-planning')
    expect(result).toBe(rows)
  })

  it('integrates with useQuery — transitions to isSuccess and exposes data', async () => {
    const rows: DriverPlanningRow[] = [
      {
        driverId: 2,
        driverName: 'Bob',
        agentCode: null,
        currentTripId: null,
        currentTripTitle: null,
        estimatedAvailableDate: null,
        estimatedAvailableLocation: null,
        confirmedAvailableDate: '2026-05-15',
        confirmedAvailableLocation: 'Dallas, TX',
        confirmedNotes: 'OK',
        canada: true,
        california: false,
        rating: 4.2,
        equipment: 'Tractor Trailer',
        homeCity: 'Dallas',
        homeState: 'TX',
        deliveries: [],
        shipments: [],
      },
    ]
    mockedApiFetch.mockResolvedValueOnce(rows)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useQuery(driverPlanningQueryOptions), {
      wrapper: Wrapper,
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(rows)
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/v1/onprem/longhaul/driver-planning')
  })

  it('integrates with useQuery — surfaces fetch errors as isError', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('boom'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useQuery(driverPlanningQueryOptions), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('boom')
  })
})

describe('useUpdateConfirmedAvailability', () => {
  it('PATCHes the right path with a JSON body excluding driverId', async () => {
    mockedApiFetch.mockResolvedValueOnce({ success: true })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateConfirmedAvailability(), {
      wrapper: Wrapper,
    })

    result.current.mutate({
      driverId: 42,
      confirmedDate: '2026-06-01',
      confirmedLocation: 'Phoenix, AZ',
      notes: 'verified',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockedApiFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mockedApiFetch.mock.calls[0]
    expect(path).toBe('/api/v1/onprem/longhaul/driver-planning/42')
    expect(init).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      confirmedDate: '2026-06-01',
      confirmedLocation: 'Phoenix, AZ',
      notes: 'verified',
    })
    expect(result.current.data).toEqual({ success: true })
  })

  it('serialises null fields in the body', async () => {
    mockedApiFetch.mockResolvedValueOnce({ success: true })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateConfirmedAvailability(), {
      wrapper: Wrapper,
    })

    result.current.mutate({
      driverId: 7,
      confirmedDate: null,
      confirmedLocation: null,
      notes: null,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [path, init] = mockedApiFetch.mock.calls[0]
    expect(path).toBe('/api/v1/onprem/longhaul/driver-planning/7')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      confirmedDate: null,
      confirmedLocation: null,
      notes: null,
    })
  })

  it('invalidates the driver-planning list query on success', async () => {
    mockedApiFetch.mockResolvedValueOnce({ success: true })

    const { queryClient, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateConfirmedAvailability(), {
      wrapper: Wrapper,
    })

    result.current.mutate({
      driverId: 1,
      confirmedDate: '2026-05-20',
      confirmedLocation: 'LAX',
      notes: null,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: driverPlanningKeys.list(),
    })
  })

  it('surfaces server errors via isError + error', async () => {
    const failure = new Error('PATCH failed')
    mockedApiFetch.mockRejectedValueOnce(failure)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateConfirmedAvailability(), {
      wrapper: Wrapper,
    })

    result.current.mutate({
      driverId: 9,
      confirmedDate: null,
      confirmedLocation: null,
      notes: null,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(failure)
  })

  it('does not invalidate queries when the mutation fails', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('nope'))

    const { queryClient, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateConfirmedAvailability(), {
      wrapper: Wrapper,
    })

    result.current.mutate({
      driverId: 5,
      confirmedDate: null,
      confirmedLocation: null,
      notes: null,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
