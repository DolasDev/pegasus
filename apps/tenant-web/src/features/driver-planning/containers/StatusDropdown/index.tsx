import React from 'react'
import { Select } from '../../components/Select'
import { useSelector } from 'react-redux'
import type { RootState } from '../../redux/store'

interface StatusDropdownProps {
  /**
   * Options appended after the legacy `MasterTripStatus` rows — for statuses
   * that exist cloud-side only and therefore never come back from MSSQL (the
   * Trips filter's synthetic "Rejected", see utils/rejected-status-filter.ts).
   */
  extraOptions?: Array<{ value: unknown; label: string }>
  [key: string]: any
}

export const StatusDropdown = ({ extraOptions, ...props }: StatusDropdownProps) => {
  const common = useSelector((state: RootState) => state.common)

  return (
    <Select
      options={[
        ...(common.tripStatuses || []).map((status: any) => ({
          value: status.status_id,
          label: status.status,
        })),
        ...(extraOptions || []),
      ]}
      {...props}
    />
  )
}
