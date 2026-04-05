import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { clsx } from 'clsx';

import styles from './TripTabs.module.css';
import { createNewTrip, setSelectedTripIndex } from 'src/redux/pending-trips';
import { Button } from 'src/components/Button';

function Tab({ trip, selected, onClick }) {
  return (
    <div role="tab" onClick={onClick} className={clsx(styles.tab, selected && styles.selected)}>
      {trip.name}
    </div>
  );
}

export function TripTabs() {
  const tripSlice = useSelector((state) => state.tripPlanning);
  const tripsInPlanningSpace = tripSlice.trips;
  const dispatch = useDispatch();
  const addNewTrip = () => {
    dispatch(createNewTrip());
  };
  const changeSelectedTripIndex = (index) => {
    dispatch(setSelectedTripIndex(index));
  };

  return (
    <div className={styles['tab-container']}>
      {tripsInPlanningSpace.map((trip, index) => (
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
  );
}
