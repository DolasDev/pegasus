import React from 'react'
import { useSelector } from 'react-redux'
import { clsx as cn } from 'clsx'

import styles from './TripTabs.module.css'
import { createNewTrip, setSelectedTripIndex } from 'src/redux/pending-trips'
import { Button } from 'src/components/Button'
import { useAppDispatch } from '../../redux/hooks'
import type { RootState } from '../../redux/store'

function Tab({ trip, selected, onClick }: { trip: any; selected: any; onClick: any }) {
  return (
    <div role="tab" onClick={onClick} className={cn(styles.tab, selected && styles.selected)}>
      {trip.name}
    </div>
  )
}

export function TripTabs() {
  const tripSlice = useSelector((state: RootState) => (state as any).tripPlanning)
  const tripsInPlanningSpace = tripSlice.trips
  const dispatch = useAppDispatch()
  const addNewTrip = () => {
    dispatch(createNewTrip(undefined) as any)
  }
  const changeSelectedTripIndex = (index: any) => {
    dispatch(setSelectedTripIndex(index) as any)
  }

  return (
    <div className={styles['tab-container']}>
      {tripsInPlanningSpace.map((trip: any, index: any) => (
        <Tab
          onClick={() => changeSelectedTripIndex(index)}
          selected={index === tripSlice.selectedTripIndex}
          key={index}
          trip={trip}
        />
      ))}
      <Button className={styles['new-trip-button']} onClick={addNewTrip}>
        +
      </Button>
    </div>
  )
}
