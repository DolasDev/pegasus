import React, { useEffect, useState } from 'react'
import { Lane } from '../../components/Lane'
import { useDebounce } from '../../utils/hooks/use-debounce'

import styles from './Shipments.module.css'
import { FilterTabs } from './components/FilterTabs'
import { ShipmentCard } from './components/ShipmentCard'
import { fetchShipments, changeShipmentQuery } from '../../redux/shipments'
import { useSelector } from 'react-redux'
// import { IconButton } from '../../components/Button';
import { ShipmentsTable } from '../ShipmentsTable'
import { useAppDispatch } from '../../redux/hooks'
import { getSortByValue } from '../../utils/sort'
import type { RootState } from '../../redux/store'

const MemoizedShipmentCards = React.memo(({ shipments }: { shipments: any[] }) => {
  const shipmentToTrips = useSelector(
    (state: RootState) => (state as any).tripPlanning.shipmentToTrips,
  )
  return shipments.map((shipment: any) => (
    <ShipmentCard
      key={shipment.order_num}
      shipment={shipment}
      tripsForShipment={Object.values(shipmentToTrips[shipment.order_num] || {})}
    />
  ))
})

const headers = [
  { label: 'Origin', value: 'shipper_state', sortable: true, width: '5' },
  { label: 'Destination', value: 'consignee_state', sortable: true, width: '5' },
  { label: 'Weight', value: 'total_est_wt', sortable: true, width: '5' },
  { label: 'Pack Date', value: 'pack_date2', sortable: true, width: '5' },
  { label: 'Load Date', value: 'load_date2', sortable: true, width: '5' },
  { label: 'Del Date', value: 'del_date2', sortable: true, width: '5' },
  //{ label: "S/H", value: "haul_mode", sortable: true, width:"5" },
  { label: 'Mode', value: 'shaul', sortable: true, width: '5' },
  { label: 'Account', value: 'company', sortable: true, width: '5' },
  { label: 'Driver', value: 'driver_name', sortable: true, width: '5' },
]

export const SearchDashboard = () => {
  const shipments = useSelector((state: RootState) => state.shipments.shipmentList)
  const query = useSelector((state: RootState) => state.shipments.query)
  const loading = useSelector((state: RootState) => state.shipments.loading)
  const release_channel = useSelector((state: RootState) => (state as any).version.release_channel)
  let [reload, setReload] = useState(0)

  const debouncedQuery = useDebounce(query, 1000)
  const dispatch = useAppDispatch()

  const changeSortBy = (value: any) => {
    dispatch(changeShipmentQuery({ sortBy: getSortByValue(query, value) }))
  }

  let countShipments = () => {
    return `(${shipments?.length})`
  }

  useEffect(() => {
    if (debouncedQuery) {
      dispatch(fetchShipments(debouncedQuery) as any)
    }
    if (release_channel === 'latest') {
      let reloadTimer = setTimeout(() => {
        setReload((reload += 1))
        console.log('reloading shipments...')
      }, 30000)
      return () => {
        clearTimeout(reloadTimer)
      }
    } else {
      return
    }
  }, [debouncedQuery, dispatch, reload])

  const [isTableMode, changeMode] = useState(false)
  return (
    <div
      className={`${styles.container} ${isTableMode ? styles.large : ''}`}
      data-target="search-dashboard"
    >
      <Lane key="Shipments" title={`Shipments ${countShipments()}`}>
        {/*
                Commenting this out because not sure how necessary this feature is
                <IconButton className={styles.iconButton} onClick={() => changeMode(state => !state)} Icon={<i className="fas fa-table"></i>} />
                */}
        <FilterTabs />
        {isTableMode ? (
          <ShipmentsTable shipments={shipments} sortBy={query.sortBy} onSort={changeSortBy} />
        ) : (
          <>
            <div className={styles.flexContainer}>
              {headers.map(({ label, value, sortable }) => (
                <b
                  className={styles.header}
                  data-target="shipment-sort-header"
                  data-sort={value}
                  onClick={() => {
                    if (sortable) changeSortBy(value)
                  }}
                  key={value}
                >
                  {label}
                  {query.sortBy && query.sortBy.value === value && (
                    <i
                      className={`fas fa-caret-up ${
                        query.sortBy.order === 'desc' ? styles.down : ''
                      }`}
                    ></i>
                  )}
                </b>
              ))}
              <div className={styles.emptyContent}></div>
            </div>
            {shipments.length || loading ? (
              <MemoizedShipmentCards shipments={shipments} />
            ) : (
              <div className={styles['empty-dislaimer']}>
                <h3>No shipments found</h3>
                Please revise your search
              </div>
            )}
          </>
        )}
      </Lane>
    </div>
  )
}
