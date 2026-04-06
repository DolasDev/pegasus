import React from 'react'
import { startCase } from 'src/utils/string'
import Autocomplete from '../../components/Autocomplete'
import { useSelector } from 'react-redux'
import type { RootState } from '../../redux/store'

export const DriverTypeahead = (args: any) => {
  const common = useSelector((state: RootState) => state.common)
  return (
    <Autocomplete
      options={(common.driversList.concat({ driver_id: 0, driver_name: 'None' }) || []).map(
        (driver: any, idx: number) => ({
          label: startCase((driver.driver_name || '').toLowerCase()),
          value: driver,
          key: idx,
        }),
      )}
      {...args}
    />
  )
}
