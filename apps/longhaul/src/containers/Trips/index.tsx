import React, { useEffect } from "react";
import { useSelector } from "react-redux";
import { Link } from 'react-router-dom';

import { Lane } from "../../components/Lane";
import { fetchTrips } from "../../redux/trips";
import { TripCard } from "./components/TripCard";
import styles from "./Trips.module.css";
import { TripsFilter } from "./components/TripsFilter";
import { useDebounce } from "../../utils/hooks/use-debounce";
import { Button } from "src/components/Button";
import { useAppDispatch } from "../../redux/hooks";
import type { RootState } from "../../redux/store";

const MemoizedTripCards = React.memo(({ trips }: { trips: any[] }) => {
  return trips.map((trip: any) => <TripCard key={trip.id} trip={trip} />);
});

export function Trips() {
  const trips = useSelector((state: RootState) => state.trips.tripList);
  const query = useSelector((state: RootState) => state.trips.query);
  const loading = useSelector((state: RootState) => state.shipments.loading);

  const debouncedQuery = useDebounce(query, 300);

  const dispatch = useAppDispatch();

  let countShipments = () => {
    return `(${trips.length})`;
  };

  useEffect(() => {
    dispatch(fetchTrips(debouncedQuery) as any);
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
