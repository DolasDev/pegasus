import logger from '../logger'
import { fetchData } from './transport'

export async function fetchHelper(name: string, ...rest: unknown[]) {
  const result = (await fetchData(name, ...rest)) as any
  if (result?.status >= 300 && result?.status < 400) {
    console.log(result.error.message)
  } else if (result?.status >= 400) {
    logger.error(result.error)
    throw new Error(result.error.message)
  }
  if (!result) {
    throw new Error(`${name} not found`)
  }
  return result.data ? JSON.parse(JSON.stringify(result.data)) : result.data
}

export const API = {
  fetchStates: () => fetchHelper('fetchStates'),
  cancelTrip: async (tripId: string) => {
    try {
      await fetchHelper('cancelTrip', tripId)
      window.alert('Trip Cancelled')
    } catch (e) {
      console.log(e)
      window.alert((e as any).message)
    }
  },
  fetchShipments: async (query: any) => {
    try {
      return await fetchHelper('fetchShipments', query)
    } catch (e) {
      window.alert((e as any).message)
      return []
    }
  },
  fetchTrips: (query: any) => fetchHelper('fetchTrips', query),
  fetchTrip: (tripId: number) => fetchHelper('fetchTrip', tripId),
  saveTrip: (trip: any) => fetchHelper('saveTrip', trip),
  updateTripSummaryInfo: (tripId: number) => fetchHelper('updateTripSummaryInfo', tripId),
  changeTripStatus: async (tripId: string, statusId: number, status: string) => {
    try {
      await fetchHelper('changeTripStatus', { tripId, statusId, status })
    } catch (e) {
      window.alert((e as any).message)
    }
  },
  fetchDrivers: () => fetchHelper('fetchDrivers'),
  fetchTripStatuses: () => fetchHelper('fetchTripStatuses'),
  saveActivity: (activityId: string, activityData: any) =>
    fetchHelper('saveActivity', { activityId, activityData }),
  fetchUser: () => fetchHelper('fetchUser'),
  fetchVersion: async () => {
    try {
      return await fetchHelper('fetchVersion')
    } catch {
      return {
        clientVersion: '1.3.10',
        supportedVersions: [{ database_version: 'N/A', supported_client_version: '1.3.10' }],
      } //Earliest Supported Version
    }
  },
  fetchZones: () => fetchHelper('fetchZones'),
  fetchPlanners: () => fetchHelper('fetchPlanners'),
  fetchDispatchers: () => fetchHelper('fetchDispatchers'),
  saveShipmentCoverage: (shipmentCoverageDto: any) =>
    fetchHelper('saveShipmentCoverage', shipmentCoverageDto),
  createTripNote: (postBody: { tripId: string; createdBy: string; note: string }) =>
    fetchHelper('createTripNote', postBody),
  patchTripNote: (patchBody: { tripId: string; id: string; note: string }) =>
    fetchHelper('patchTripNote', patchBody),
  patchShipmentShadow: (shipmentShadowDto: any) =>
    fetchHelper('patchShipmentShadow', shipmentShadowDto),
  jumpToOrder: async (args: any) => {
    try {
      await fetchHelper('pegasusRemoteFunctionCall', { eventType: 'openOrder', eventData: args })
    } catch (e) {
      console.log(e)
      window.alert((e as any).message)
    }
  },
  fetchFilterOptions: () => fetchHelper('fetchFilterOptions'),
  saveShipmentsFilter: async (payload: any) => {
    try {
      await fetchHelper('saveShipmentsFilter', payload)
    } catch (e) {
      console.error(e)
      window.alert((e as any).message)
    }
  },
  fetchShipmentDefaultFilterForUser: (_userCode?: any) => {
    return fetchHelper('fetchShipmentDefaultFilterForUser')
  },
  fetchSavedShipmentFilters: (obj: { type: 'self' | 'public'; userCode: string }) => {
    return fetchHelper('fetchSavedShipmentFilters', obj)
  },
  setDefaultShipmentFilter: (shipmentFilterId: number) => {
    return fetchHelper('setDefaultShipmentFilter', shipmentFilterId)
  },
  deleteShipmentFilter: (shipmentFilterId: number) => {
    return fetchHelper('deleteShipmentFilter', shipmentFilterId)
  },
}
