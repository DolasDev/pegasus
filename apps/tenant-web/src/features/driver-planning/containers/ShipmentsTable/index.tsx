import React from 'react'

import { Table } from '../../components/Table'
import { formatDate } from '../../utils/format-date'
import type { SortBy } from '../../utils/sort'

function dateFormatter(date: any): string {
  return date ? formatDate(date) || '' : ''
}

function dateRange(date1: any, date2: any): string {
  return `${dateFormatter(date1)} - ${dateFormatter(date2)}`
}

// `sortKey` is the server-side sort field; for the date-range columns it is the
// range end (`*_date2`), matching the Shipments card-view sort headers.
const tableConfig = [
  { label: 'Shipper', property: 'shipper_name' },
  { label: 'Origin City', property: 'shipper_city' },
  { label: 'O St', property: 'shipper_state' },
  { label: 'D City', property: 'consignee_city' },
  { label: 'D St', property: 'consignee_state' },
  { label: 'Est Wt', property: 'total_est_wt' },
  {
    label: 'Pack Range',
    property: 'pack_date',
    property2: 'pack_date2',
    sortKey: 'pack_date2',
    accessor: ({ pack_date, pack_date2 }: any) => dateRange(pack_date, pack_date2),
  },
  {
    label: 'Load Range',
    sortKey: 'load_date2',
    accessor: ({ load_date, load_date2 }: any) => dateRange(load_date, load_date2),
  },
  {
    label: 'Del Range',
    sortKey: 'del_date2',
    accessor: ({ del_date, del_date2 }: any) => dateRange(del_date, del_date2),
  },
]

interface ShipmentsTableProps {
  shipments: any[]
  /** When provided, clicking a row calls this with the shipment. */
  onRowClick?: (shipment: any) => void
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
      rowId={(row) => row.order_num}
      sortBy={sortBy}
      onSort={onSort}
    />
  )
}
