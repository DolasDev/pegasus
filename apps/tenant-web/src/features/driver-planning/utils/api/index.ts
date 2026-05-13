import logger from '../logger'
import { notifyError, notifySuccess } from '../../components/Snackbar/notify'
import { fetchData } from './transport'
import { reshapeTrip, reshapeTripList } from './reshape-trip'
import { reshapeShipmentList } from './reshape-shipment'
import { fetchAndReshape } from './fetch-and-reshape'

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
      notifySuccess('Trip Cancelled')
    } catch (e) {
      console.log(e)
      notifyError((e as any).message)
    }
  },
  // The on-prem bridge left-joins the `sales` shadow columns flat
  // (`shadow_weight`, `shadow_comments`, `operations_*`); reshape them back into
  // the nested `pegasus_shadow` object the ported components (ShipmentDetail,
  // DispatchNote, Weight) were written against. fetchAndReshape contains the
  // error→snackbar→empty-list fallback so the module doesn't error-boundary on
  // a transient bridge hiccup.
  fetchShipments: async (query: any) =>
    fetchAndReshape(fetchHelper, 'fetchShipments', [query], reshapeShipmentList, []),
  // The on-prem bridge returns trips with relations flattened into aliased
  // columns; reshape them back into the nested shape the ported components
  // (TripCard, the trip-detail Gantt, PendingTrips) were written against.
  fetchTrips: async (query: any) => reshapeTripList(await fetchHelper('fetchTrips', query)),
  fetchTrip: async (tripId: number) => reshapeTrip(await fetchHelper('fetchTrip', tripId)),
  saveTrip: (trip: any) => fetchHelper('saveTrip', trip),
  updateTripSummaryInfo: (tripId: number) => fetchHelper('updateTripSummaryInfo', tripId),
  changeTripStatus: async (tripId: string, statusId: number, status: string) => {
    try {
      await fetchHelper('changeTripStatus', { tripId, statusId, status })
    } catch (e) {
      notifyError((e as any).message)
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
    // TODO(longhaul-port): jumping to an order in the legacy WinForms app
    // requires the on-prem-only `pegasusRemoteFunctionCall` shell-out. There
    // is no cloud equivalent yet — surface a notice instead of a stack trace.
    console.warn('[longhaul-port] jumpToOrder stubbed; args:', args)
    notifyError(
      'Opening an order in the legacy desktop app is not yet supported in the cloud. This will be wired up in a future phase.',
    )
  },
  fetchFilterOptions: () => fetchHelper('fetchFilterOptions'),
  saveShipmentsFilter: async (payload: any) => {
    try {
      await fetchHelper('saveShipmentsFilter', payload)
    } catch (e) {
      console.error(e)
      notifyError((e as any).message)
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
