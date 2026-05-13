import React, { useEffect } from 'react'
import { ShipmentsTable } from '../containers/ShipmentsTable'
import { useSelector } from 'react-redux'
import { FilterTabs } from '../containers/Shipments/components/FilterTabs'
import { Lane } from '../components/Lane'
import { fetchShipments, selectShipment } from '../redux/shipments'
import { ShipmentDetail } from '../containers/ShipmentDetail'
import { useAppDispatch } from '../redux/hooks'
import { useDebounce } from '../utils/hooks/use-debounce'
import type { RootState } from '../redux/store'

export function ShipmentModule() {
  const shipments = useSelector((state: RootState) => state.shipments.shipmentList)
  const query = useSelector((state: RootState) => state.shipments.query)
  const dispatch = useAppDispatch()
  // Mirror the SearchDashboard (left pane of /planning): the legacy desktop app
  // only ever populated `shipments.shipmentList` from that pane, so the standalone
  // /shipments route showed an empty table until you'd searched there. As a web
  // route it has to be self-sufficient — fetch on mount and whenever the query
  // (default filter, saved filter, FilterTabs edits) changes.
  const debouncedQuery = useDebounce(query, 1000)
  useEffect(() => {
    if (debouncedQuery) dispatch(fetchShipments(debouncedQuery) as any)
  }, [debouncedQuery, dispatch])

  return (
    <>
      {/* Selecting a row populates `shipments.selectedShipment`, which the
          ShipmentDetail pane reads (same flow as the /planning + trip-detail
          surfaces). */}
      <ShipmentDetail />
      <h1>Shipments Module</h1>
      <Lane key="Shipments" title="Shipments">
        <FilterTabs />
        <ShipmentsTable
          shipments={shipments}
          onRowClick={(shipment) => dispatch(selectShipment(shipment) as any)}
        />
      </Lane>
    </>
  )
}
