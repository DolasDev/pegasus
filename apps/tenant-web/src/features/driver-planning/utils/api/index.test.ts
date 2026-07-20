import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the transport layer (fetchData) — unit 04 covers envelope behavior.
vi.mock('./transport', () => ({
  fetchData: vi.fn(),
}))

// Mock the logger to avoid console noise / side effects.
vi.mock('../logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Mock the Snackbar bridge — production code now surfaces user-facing messages
// via notify/notifyError/notifySuccess instead of window.alert.
const { notifyMock, notifyErrorMock, notifySuccessMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  notifyErrorMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}))
vi.mock('../../components/Snackbar/notify', () => ({
  notify: notifyMock,
  notifyError: notifyErrorMock,
  notifySuccess: notifySuccessMock,
}))

// jumpToOrder delegates to the launcher module — mock it so the API surface
// test stays a pure delegation check (the launcher has its own unit tests).
const { jumpToOrderImplMock } = vi.hoisted(() => ({ jumpToOrderImplMock: vi.fn() }))
vi.mock('../jump-to-order', () => ({ jumpToOrder: jumpToOrderImplMock }))

import { fetchData } from './transport'
import { API } from './index'

const fetchDataMock = vi.mocked(fetchData)

const okEnvelope = (data: unknown) => ({ status: 200, data, error: undefined })

describe('API surface', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  // Silence noise from production error paths: cancelTrip uses console.log, saveShipmentsFilter uses console.error.
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchDataMock.mockReset()
    notifyMock.mockReset()
    notifyErrorMock.mockReset()
    notifySuccessMock.mockReset()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  describe('plain GET helpers', () => {
    it.each([
      ['fetchStates', []],
      ['fetchDrivers', []],
      ['fetchTripStatuses', []],
      ['fetchUser', []],
      ['fetchZones', []],
      ['fetchPlanners', []],
      ['fetchDispatchers', []],
      ['fetchFilterOptions', []],
      ['fetchReferenceData', []],
    ])('API.%s() invokes fetchData("%s")', async (name, args) => {
      fetchDataMock.mockResolvedValue(okEnvelope([{ id: 1 }]))
      const result = await (API as any)[name](...args)
      expect(fetchDataMock).toHaveBeenCalledWith(name)
      expect(result).toEqual([{ id: 1 }])
    })
  })

  describe('fetchHelper error propagation', () => {
    it('preserves the API error code on the thrown Error', async () => {
      // The reference-data bootstrap branches on `code` to treat
      // MSSQL_NOT_CONFIGURED as a benign empty state; fetchHelper must carry it
      // through rather than flatten it to a message-only Error.
      fetchDataMock.mockResolvedValue({
        status: 422,
        data: undefined,
        error: {
          message: 'Legacy database not configured for this tenant',
          code: 'MSSQL_NOT_CONFIGURED',
        },
      })
      await expect(API.fetchReferenceData()).rejects.toMatchObject({
        message: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
      })
    })

    it('still throws (without a code) when the error envelope has none', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'boom' },
      })
      await expect(API.fetchReferenceData()).rejects.toThrow('boom')
    })
  })

  describe('fetchTrips / fetchTrip / saveTrip', () => {
    it('fetchTrips passes the query through', async () => {
      const query = { driverId: 'd1' }
      fetchDataMock.mockResolvedValue(okEnvelope([{ id: 1 }]))
      await API.fetchTrips(query)
      expect(fetchDataMock).toHaveBeenCalledWith('fetchTrips', query)
    })

    it('fetchTrip passes the trip id through', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({ id: 7 }))
      await API.fetchTrip(7)
      expect(fetchDataMock).toHaveBeenCalledWith('fetchTrip', 7)
    })

    it('saveTrip passes the trip body through', async () => {
      const trip = { id: 7, driverId: 'd1' }
      fetchDataMock.mockResolvedValue(okEnvelope(trip))
      const result = await API.saveTrip(trip)
      expect(fetchDataMock).toHaveBeenCalledWith('saveTrip', trip)
      expect(result).toEqual(trip)
    })

    it('updateTripSummaryInfo passes the trip id through', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({}))
      await API.updateTripSummaryInfo(42)
      expect(fetchDataMock).toHaveBeenCalledWith('updateTripSummaryInfo', 42)
    })
  })

  describe('cancelTrip', () => {
    it('pushes a "Trip Canceled" success snackbar on success', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope(null))
      await API.cancelTrip('t1')
      expect(fetchDataMock).toHaveBeenCalledWith('cancelTrip', 't1')
      expect(notifySuccessMock).toHaveBeenCalledWith('Trip Canceled')
    })

    it('pushes an error snackbar and swallows on failure', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'boom' },
      })
      await expect(API.cancelTrip('t1')).resolves.toBeUndefined()
      expect(notifyErrorMock).toHaveBeenCalledWith('boom')
    })
  })

  describe('changeTripStatus', () => {
    it('forwards the status change payload', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope(null))
      await API.changeTripStatus('t1', 3, 'EN_ROUTE')
      expect(fetchDataMock).toHaveBeenCalledWith('changeTripStatus', {
        tripId: 't1',
        statusId: 3,
        status: 'EN_ROUTE',
      })
    })

    it('pushes an error snackbar on failure and does not throw', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'nope' },
      })
      await expect(API.changeTripStatus('t1', 3, 'X')).resolves.toBeUndefined()
      expect(notifyErrorMock).toHaveBeenCalledWith('nope')
    })
  })

  describe('fetchShipments', () => {
    it('forwards the query and reshapes the flat shadow columns', async () => {
      const query = { searchTerm: 'foo' }
      fetchDataMock.mockResolvedValue(okEnvelope([{ order_num: 1, shadow_weight: 8200 }]))
      const result = await API.fetchShipments(query)
      expect(fetchDataMock).toHaveBeenCalledWith('fetchShipments', query)
      expect(result[0]).toMatchObject({ order_num: 1, pegasus_shadow: { weight: 8200 } })
    })

    it('returns [] and pushes an error snackbar on failure', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'fail' },
      })
      const result = await API.fetchShipments({})
      expect(result).toEqual([])
      expect(notifyErrorMock).toHaveBeenCalledWith('fail')
    })
  })

  describe('saveShipmentCoverage / patchShipmentShadow', () => {
    it('saveShipmentCoverage forwards the dto', async () => {
      const dto = { order_num: 1, coverage: 'FULL' }
      fetchDataMock.mockResolvedValue(okEnvelope(dto))
      await API.saveShipmentCoverage(dto)
      expect(fetchDataMock).toHaveBeenCalledWith('saveShipmentCoverage', dto)
    })

    it('patchShipmentShadow forwards the dto', async () => {
      const dto = { order_num: 99, shadow: true }
      fetchDataMock.mockResolvedValue(okEnvelope(dto))
      await API.patchShipmentShadow(dto)
      expect(fetchDataMock).toHaveBeenCalledWith('patchShipmentShadow', dto)
    })
  })

  describe('trip notes', () => {
    it('createTripNote forwards the body', async () => {
      const body = { tripId: 't1', createdBy: 'u1', note: 'hi' }
      fetchDataMock.mockResolvedValue(okEnvelope({ id: 'n1' }))
      await API.createTripNote(body)
      expect(fetchDataMock).toHaveBeenCalledWith('createTripNote', body)
    })

    it('patchTripNote forwards the body', async () => {
      const body = { tripId: 't1', id: 'n1', note: 'edited' }
      fetchDataMock.mockResolvedValue(okEnvelope({ id: 'n1' }))
      await API.patchTripNote(body)
      expect(fetchDataMock).toHaveBeenCalledWith('patchTripNote', body)
    })
  })

  describe('saveActivity', () => {
    it('forwards activityId + activityData wrapped together', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({}))
      await API.saveActivity('a1', { foo: 'bar' })
      expect(fetchDataMock).toHaveBeenCalledWith('saveActivity', {
        activityId: 'a1',
        activityData: { foo: 'bar' },
      })
    })
  })

  describe('fetchVersion', () => {
    it('returns the server payload on success', async () => {
      const payload = {
        clientVersion: '2.0.0',
        supportedVersions: [{ database_version: '7', supported_client_version: '2.0.0' }],
      }
      fetchDataMock.mockResolvedValue(okEnvelope(payload))
      const result = await API.fetchVersion()
      expect(result).toEqual(payload)
    })

    it('falls back to a static earliest-supported-version on failure', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'boom' },
      })
      const result = await API.fetchVersion()
      expect(result).toEqual({
        clientVersion: '1.3.10',
        supportedVersions: [{ database_version: 'N/A', supported_client_version: '1.3.10' }],
      })
    })
  })

  describe('shipment filters', () => {
    it('fetchSavedShipmentFilters forwards the obj', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope([]))
      await API.fetchSavedShipmentFilters({ type: 'self', userCode: 'u1' })
      expect(fetchDataMock).toHaveBeenCalledWith('fetchSavedShipmentFilters', {
        type: 'self',
        userCode: 'u1',
      })
    })

    it('fetchShipmentDefaultFilterForUser ignores its arg and calls without args', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({ filter_id: 1 }))
      await API.fetchShipmentDefaultFilterForUser('u1')
      expect(fetchDataMock).toHaveBeenCalledWith('fetchShipmentDefaultFilterForUser')
    })

    it('saveShipmentsFilter forwards the payload', async () => {
      const payload = { name: 'mine' }
      fetchDataMock.mockResolvedValue(okEnvelope({}))
      await API.saveShipmentsFilter(payload)
      expect(fetchDataMock).toHaveBeenCalledWith('saveShipmentsFilter', payload)
    })

    it('saveShipmentsFilter pushes an error snackbar on failure and does not throw', async () => {
      fetchDataMock.mockResolvedValue({
        status: 500,
        data: undefined,
        error: { message: 'nope' },
      })
      await expect(API.saveShipmentsFilter({})).resolves.toBeUndefined()
      expect(notifyErrorMock).toHaveBeenCalledWith('nope')
    })

    it('setDefaultShipmentFilter forwards the filter id', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({}))
      await API.setDefaultShipmentFilter(7)
      expect(fetchDataMock).toHaveBeenCalledWith('setDefaultShipmentFilter', 7)
    })

    it('deleteShipmentFilter forwards the filter id', async () => {
      fetchDataMock.mockResolvedValue(okEnvelope({}))
      await API.deleteShipmentFilter(7)
      expect(fetchDataMock).toHaveBeenCalledWith('deleteShipmentFilter', 7)
    })
  })

  describe('jumpToOrder', () => {
    beforeEach(() => jumpToOrderImplMock.mockReset())

    it('delegates to the launcher with the order_num args', () => {
      API.jumpToOrder({ order_num: 42 })
      expect(jumpToOrderImplMock).toHaveBeenCalledWith({ order_num: 42 })
    })

    it('does not call fetchData', () => {
      API.jumpToOrder({ order_num: 42 })
      expect(fetchDataMock).not.toHaveBeenCalled()
    })
  })
})
