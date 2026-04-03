import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Link } from 'react-router-dom';

import { Lane } from "../../components/Lane";
import { fetchTrips } from "../../redux/trips";
import { TripCard } from "./components/TripCard";
import styles from "./Trips.module.css";
import { TripsFilter } from "./components/TripsFilter";
import { useDebounce } from "../../utils/hooks/use-debounce";
import { Button } from "src/components/Button";

const MemoizedTripCards = React.memo(({ trips }) => {
  return trips.map(trip => <TripCard key={trip.id} trip={trip} />);
});

export function Trips() {
  const trips = useSelector(state => state.trips.tripList);
  const query = useSelector(state => state.trips.query);
  const loading = useSelector(state => state.shipments.loading);

  const debouncedQuery = useDebounce(query, 300);

  const dispatch = useDispatch();

  let countShipments = () => {
    return `(${trips.length})`;
  };

  useEffect(() => {
    dispatch(fetchTrips(debouncedQuery));
  }, [dispatch, debouncedQuery]);

  return (
    <Lane key="Trips" title={`Trips ${countShipments()}`}>
      <Link to="/planning" className={styles.newTripButton}>
        <Button>
          New Trip
        </Button>
      </Link>
      <div className={styles["trip-container"]}>
        <div className={styles["filter-container"]}>
          <TripsFilter />
        </div>
        <div className={styles["trips-card-container"]}>
          {trips.length || loading ? (
            <MemoizedTripCards trips={trips} />
          ) : (
            <div className={styles["empty-dislaimer"]}>
              <h3>No trips found</h3>
              Please revise your search
            </div>
          )}
        </div>
      </div>
    </Lane>
  );
}
