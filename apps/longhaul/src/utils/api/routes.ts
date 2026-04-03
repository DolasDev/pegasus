// ---------------------------------------------------------------------------
// IPC route name → HTTP request descriptor
// Each entry maps the former Electron IPC route to the Phase 3 HTTP endpoint.
// ---------------------------------------------------------------------------

export interface HttpRequest {
  method: string
  path: string
  body?: unknown
}

export function resolveRoute(routeName: string, args: unknown[]): HttpRequest {
  const arg0 = args[0] as any

  switch (routeName) {
    // ---- Reference data (simple GETs) ----
    case 'fetchStates':
      return { method: 'GET', path: '/states' }
    case 'fetchZones':
      return { method: 'GET', path: '/zones' }
    case 'fetchDrivers':
      return { method: 'GET', path: '/drivers' }
    case 'fetchTripStatuses':
      return { method: 'GET', path: '/trip-statuses' }
    case 'fetchPlanners':
      return { method: 'GET', path: '/planners' }
    case 'fetchDispatchers':
      return { method: 'GET', path: '/dispatchers' }
    case 'fetchUser':
      return { method: 'GET', path: '/users/me' }
    case 'fetchVersion':
      return { method: 'GET', path: '/version' }
    case 'fetchFilterOptions':
      return { method: 'GET', path: '/filter-options' }

    // ---- Trips ----
    case 'fetchTrips': {
      const qs = arg0 ? `?filters=${encodeURIComponent(JSON.stringify(arg0))}` : ''
      return { method: 'GET', path: `/trips${qs}` }
    }
    case 'fetchTrip':
      return { method: 'GET', path: `/trips/${arg0}` }
    case 'saveTrip':
      return arg0?.id
        ? { method: 'PUT', path: `/trips/${arg0.id}`, body: arg0 }
        : { method: 'POST', path: '/trips', body: arg0 }
    case 'cancelTrip':
      return { method: 'POST', path: `/trips/${arg0}/cancel` }
    case 'changeTripStatus': {
      const { tripId, statusId, status } = arg0
      return { method: 'PATCH', path: `/trips/${tripId}/status`, body: { statusId, status } }
    }
    case 'updateTripSummaryInfo':
      return { method: 'PATCH', path: `/trips/${arg0}/summary`, body: {} }
    case 'createTripNote': {
      const { tripId, createdBy, note } = arg0
      return { method: 'POST', path: `/trips/${tripId}/notes`, body: { note, createdBy } }
    }
    case 'patchTripNote': {
      const { id, tripId, note } = arg0
      return { method: 'PATCH', path: `/notes/${id}`, body: { note, tripId } }
    }

    // ---- Shipments ----
    case 'fetchShipments': {
      const query: Record<string, unknown> = arg0 ?? {}
      const { searchTerm, ...filters } = query
      const parts: string[] = []
      if (Object.keys(filters).length) {
        parts.push(`filters=${encodeURIComponent(JSON.stringify(filters))}`)
      }
      if (searchTerm) {
        parts.push(`searchTerm=${encodeURIComponent(String(searchTerm))}`)
      }
      const qs = parts.length ? `?${parts.join('&')}` : ''
      return { method: 'GET', path: `/shipments${qs}` }
    }
    case 'saveShipmentCoverage': {
      const orderNum = arg0?.order_num ?? 0
      return { method: 'POST', path: `/shipments/${orderNum}/coverage`, body: arg0 }
    }
    case 'patchShipmentShadow': {
      const orderNum = arg0?.order_num ?? 0
      return { method: 'PATCH', path: `/shipments/${orderNum}/shadow`, body: arg0 }
    }

    // ---- Activities ----
    case 'saveActivity': {
      const { activityId, activityData } = arg0
      return { method: 'POST', path: `/activities/${activityId}`, body: activityData }
    }

    // ---- Shipment filters ----
    case 'fetchSavedShipmentFilters':
      return { method: 'GET', path: '/shipment-filters' }
    case 'fetchShipmentDefaultFilterForUser':
      return { method: 'GET', path: '/shipment-filters/default' }
    case 'saveShipmentsFilter':
      return { method: 'POST', path: '/shipment-filters', body: arg0 }
    case 'setDefaultShipmentFilter':
      return { method: 'PUT', path: '/shipment-filters/default', body: { filter_id: arg0 } }
    case 'deleteShipmentFilter':
      return { method: 'DELETE', path: `/shipment-filters/${arg0}` }

    // ---- Remote (Windows-only) ----
    case 'pegasusRemoteFunctionCall':
      return { method: 'POST', path: '/remote/jump-to-order', body: arg0?.eventData }

    default:
      throw new Error(`Unknown longhaul route: ${routeName}`)
  }
}
