import React from 'react'

import { Table, type TableColumn } from '../../components/Table'
import { formatDate } from '../../utils/format-date'
import type { SortBy } from '../../utils/sort'
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

function dateFormatter(date: any): string {
  return date ? formatDate(date) || '' : ''
}

function dateRange(date1: any, date2: any): string {
  return `${dateFormatter(date1)} - ${dateFormatter(date2)}`
}

// A shipment's date range ("spread") is `*_date2` → `plan_*`: `*_date2` is the
// range START and `plan_*` the END. Every other surface reads the pair that way
// — ShipmentDetail's "… Date Spread" rows, the ShipmentCard columns,
// Trip/utils/peg-dates, and the API's own date filters (shipments-list.ts pairs
// `plan_load` with `load_date2`).
//
// These columns previously read `pack_date` / `load_date` / `del_date` as the
// range start. No such column exists on `v_longhaul_shipments_v2` — those names
// are saved-filter query keys, not row fields — so the start always rendered
// blank and the value shown on the right was really the range start.
//
// `sortKey` is the server-side sort field; for the date-range columns it is the
// range start (`*_date2`), matching the Shipments card-view sort headers.
// Annotated, so a `property` naming something that is not a column on the
// view is a compile error rather than a blank column.
const tableConfig: TableColumn<LonghaulShipmentRow>[] = [
  { label: 'Shipper', property: 'shipper_name' },
  { label: 'Origin City', property: 'shipper_city' },
  { label: 'O St', property: 'shipper_state' },
  { label: 'D City', property: 'consignee_city' },
  { label: 'D St', property: 'consignee_state' },
  { label: 'Est Wt', property: 'total_est_wt' },
  {
    label: 'Pack Range',
    sortKey: 'pack_date2',
    accessor: ({ pack_date2, plan_pack }: any) => dateRange(pack_date2, plan_pack),
  },
  {
    label: 'Load Range',
    sortKey: 'load_date2',
    accessor: ({ load_date2, plan_load }: any) => dateRange(load_date2, plan_load),
  },
  {
    label: 'Del Range',
    sortKey: 'del_date2',
    accessor: ({ del_date2, plan_del }: any) => dateRange(del_date2, plan_del),
  },
]

interface ShipmentsTableProps {
  shipments: LonghaulShipmentRow[]
  /** When provided, clicking a row calls this with the shipment. */
  onRowClick?: (shipment: LonghaulShipmentRow) => void
  /** Current sort state, used to render the active-column indicator. */
  sortBy?: SortBy | null
  /** When provided, column headers become clickable and call this with the sort field. */
  onSort?: (sortKey: string) => void
}

export const ShipmentsTable: React.FC<ShipmentsTableProps> = ({
  shipments,
  onRowClick,
  sortBy,
  onSort,
}) => {
  return (
    <Table
      rows={shipments}
      tableConfig={tableConfig}
      rowTarget="shipment-table-row"
      onRowClick={onRowClick}
      rowId={(row) => row.order_num ?? undefined}
      sortBy={sortBy}
      onSort={onSort}
    />
  )
}
