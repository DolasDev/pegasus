import React, { useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import get from 'lodash/get';
import sortBy from 'lodash/sortBy';
import { Link } from 'react-router-dom';

import { Lane } from '../../components/Lane';
import { Button } from '../../components/Button';

import styles from './PendingTrips.module.css';
import {
  saveTrip as saveTripAction,
  removeShipmentFromTrip,
  editTrip as editTripAction,
  removeActivity as removeActivityAction,
  editActivity as editActivityAction,
  initializeTripPage as clearCurrentTripAction,
  cancelTrip as cancelTripAction
} from '../../redux/pending-trips';
import { changeShipmentQuery as reloadShipmentsAction } from '../../redux/shipments';
import { Card } from '../../components/Card';
import { TripDetail, DriverTripDetail, NameTripDetail, DispatcherTripDetail } from './TripDetail';
import { InputField } from '../../components/InputField';
import { Snackbar } from '../../components/Snackbar';
import { DriverTypeahead } from '../DriverTypeahead';
import { formatDate } from '../../utils/format-date';
import { AddActivity } from './components/AddActivity';
import { EditActivity } from './components/EditActivity';
import { useFloating, offset } from '@floating-ui/react';
import { Popover } from 'src/components/Popover';


const createFromToDateString = (startDate, endDate) => `${formatDate(startDate)} - ${formatDate(endDate)}`;

const createTripString = (trip) =>
  `${trip.shipper_city}, ${trip.shipper_state} - ${trip.consignee_city}, ${trip.consignee_state}`;

const getTotalWeight = (shipments) =>
  shipments.reduce((accumulator, current) => Number(current.total_est_wt || 0) + accumulator, 0).toLocaleString();

const getTotalPrice = (shipments) =>
  shipments.reduce((accumulator, current) => Number(current.line_haul || 0) + accumulator, 0).toFixed(0).toLocaleString();

const dashboardSettings = {
  title: (shipment) => createTripString(shipment),
  children: (shipment) =>
    [
      `${shipment.shipper_name}, ${shipment.order_num}, ${shipment.avl_reg}`,
      `Weight: ${shipment.total_est_wt ? `${shipment.total_est_wt?.toLocaleString()}lbs`: 'N/A'} | Linehaul: $${shipment.line_haul?.toLocaleString()}`,
      
    ].map((str, i) => <div key={i}>{str}</div>),
};

const Activity = ({ activity, onDelete, editActivityDates }) => {
  const [ editActivity , setEditActivity] = useState(false);
  const [ editElement , setEditElement] = useState(null);
  
  const dispatch = useDispatch();

  const openActivityDates = () => {
    if (activity.activityType.isCanEditDates) {
      setEditActivity(true)
    }
  }

  const closeEditActivity = () => {
    setEditActivity(false)
  }

  const editDateSpread = (dates) => {
    editActivityDates({
      //...editActivity,
      planned_start: dates.start_date, 
      planned_end: dates.end_date, 
    })  
  }
  
  return(
  <>
    <div 
      className={styles.activityCard} ref={setEditElement}
      onClick={openActivityDates}
      >
      <span>{`${activity.activityType?.abbreviation} ${createFromToDateString(activity.planned_start, activity.planned_end)}`}</span>
      <button
        className={`${styles.iconButton} ${styles.floatingDeleteButton}`}
        onClick={() => {
          onDelete();
        }}
      >
        <i className="fas fa-trash"></i>
      </button>
    </div>
    {editActivity ? (
      <EditActivity
        activity={activity}  
        _referenceElement={editElement} 
        closeEditActivity={closeEditActivity}
        editDateSpread={editDateSpread}
      />) : ''}
  </>)
};

const MoreTripActions = ({ tripId }) => {
  const { user: planner } = useSelector((state) => state.user);
  const [isOpen, setOpen] = useState(false);
  const dispatch = useDispatch();
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  });

  const cancelTrip = async () => {
    const confirm = window.confirm('Are you sure you want to cancel the trip');
    if (confirm === true) {
      dispatch(cancelTripAction(tripId, planner));
      dispatch(reloadShipmentsAction({}));
    }
    setOpen(false);
  }

  return (
    <>
      <Button ref={refs.setReference} onClick={() => setOpen((state) => !state)}>
        <i className="fa fa-ellipsis-v" />
      </Button>
      {isOpen &&
        <Popover
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            padding: 0,
          }}
        >
            <div className={styles.menu}>
              <div className={styles.menuItem} onClick={cancelTrip}>
                Cancel Trip
              </div>
            </div>
        </Popover>
      }
    </>
  );
}

const PendingTripsInternal = (props) => {
  const { trip: currentTrip } = useSelector((state) => state.tripPlanning);
  const { user: planner } = useSelector((state) => state.user);
  let [saveDisabled, setSaveDisabled ] = useState(false)
  
  const [snackBarConfig, setShowSnackbar] = useState({
    show: false,
    message: '',
  });
  const dispatch = useDispatch();

  const { driversMap } = useSelector(
    (state) => ({
      driversMap: new Map(state.common.driversList.map((driver) => [driver.driver_id, driver])),
    }),
    () => false, // only update when remounting
  );

  const removeShipment = (index) => {
    dispatch(removeShipmentFromTrip(index));
  };
  const editTrip = (trip) => {
    dispatch(editTripAction(trip));
  };
  
  const removeActivity = (shipmentIndex, activityIndex) => {
    dispatch(
      removeActivityAction({
        shipmentIndex,
        activityIndex,
      }),
    );
  };

  const editActivity = (shipmentIndex, activityIndex, partialActivity) => {
    dispatch(
      editActivityAction({
        shipmentIndex,
        activityIndex,
        partialActivity
      }),
    );
  };

  const saveTrip = async (trip) => {
    try {
      await dispatch(saveTripAction(trip));
      console.log('Succesfully saved trip');
      setShowSnackbar({
        show: true,
        message: 'Succesfully saved trip',
        type: 'success',
      });
    } catch (e) {
      console.log(e);
      setShowSnackbar({
        show: true,
        message: <>Failed to save trip! <br /> {e.message} </>,
        type: 'error',
      });
    }
    dispatch(reloadShipmentsAction());
    setSaveDisabled(false)
  };

  const clearCurrentTrip = (trip) => {
    const prompt = window.confirm('Are you sure you want to clear the current trip and start a new one?');
    if (prompt) {
      dispatch(clearCurrentTripAction(null, planner))
    }
  }


  return (
    <div className={styles.container}>
      <Lane key="Pending Trips" title="Pending Trips">
        <div>
          <div className={styles.content}>
            <NameTripDetail
              currentTrip={currentTrip}
              label="Trip Name"
              property="trip_title"
              //editLabel="edit"
              displayVal={currentTrip.trip_title}
              editTrip={editTrip}
              editVal={currentTrip.trip_title}
              EditComponent={nameEdit}
            />
            <DriverTripDetail
              currentTrip={currentTrip}
              label="Driver"
              property="driver"
              editLabel="Change Driver"
              displayVal={currentTrip.driver?.driver_name|| ''}
              placeholder={currentTrip.driver?.driver_name || ''}
              editTrip={editTrip}
              EditComponent={TypeAheadEdit}
            />
            <div className={styles['driver-select-container']}>
              <DispatcherTripDetail 
                currentTrip={currentTrip}
                label="Dispatcher"
                property="dispatcher"
                editLabel="Change Dispatcher"
                displayVal={currentTrip.dispatcher ? `${currentTrip.dispatcher.first_name} ${currentTrip.dispatcher.last_name}` : ''}
                placeholder={currentTrip.dispatcher ? `${currentTrip.dispatcher.first_name} ${currentTrip.dispatcher.last_name}` : ''}
                editTrip={editTrip}
              />
            </div>
            <div className={styles.row}>
              <TripDetail
                currentTrip={currentTrip}
                label="Total Weight"
                editLabel="edit"
                displayVal={`${getTotalWeight(currentTrip.shipments)} LB`}
                editTrip={false}
                editable={false}
                EditComponent={(props) => null}
              />
              <TripDetail
                currentTrip={currentTrip}
                label="Total Linehaul"
                editLabel="edit"
                displayVal={`$${getTotalPrice(currentTrip.shipments)}`}
                editTrip={false}
                editable={false}
                EditComponent={(props) => null}
              />
            </div>
            <div className={styles['pending-trip-buttons-container']}>
              {currentTrip.shipments.length > 0  ? (
                <Button
                  color="green"
                  inverted
                  onClick={() => {
                    clearCurrentTrip(currentTrip);
                  }}
                >
                New Trip
              </Button>
              ): null}
              <Button
                disabled={saveDisabled}
                onClick={() => {
                  setSaveDisabled(true)
                  console.log('saving...')
                  saveTrip(currentTrip);
                }}
              >
                Save
              </Button>
              {!!currentTrip?.id ? <MoreTripActions tripId={currentTrip?.id} /> : null}
            </div>
            <div className={styles['trip-card-container']}>
              {currentTrip.id && (
                <Link to={`/trip/${currentTrip.id}`} className={styles['title']}>
                  View Itinerary #{currentTrip.id}
                </Link>
              )}
              <div className={styles['title']}>Shipments</div>
              {!currentTrip.shipments.length && (
                <div className={styles['no-trips-disclaimer']}>
                  <h3>No shipments for trip</h3>
                  <div>Please add a shipment to this trip by selecting one in the left panel</div>
                </div>
              )}
              {[...currentTrip.shipments.map((shipment, idx) => ({...shipment, stateIdx: idx}))].sort((a, b) => a.load_date < b.load_date ? -1 : a.load_date > b.load_date ? 1 : 0).map((shipment) => (
                <Card key={shipment.order_num} title={dashboardSettings.title(shipment)}>
                  {dashboardSettings.children(shipment)}
                  <div className={styles.activityCreationContainer}>
                    <h3>Activities</h3>
                    <AddActivity shipment={shipment} shipmentIndex={shipment.stateIdx} />
                  </div>
                  {shipment.activities.map((activity, activityIndex) => (
                    <Activity
                      key={activityIndex}
                      activity={activity}
                      onDelete={() => removeActivity(shipment.stateIdx, activityIndex)}
                      editActivityDates={(partialActivity) => editActivity(shipment.stateIdx, activityIndex, partialActivity)}
                    />
                  ))}
                  <button
                    className={`${styles.iconButton} ${styles.floatingDeleteButton}`}
                    onClick={() => {
                      removeShipment(shipment.stateIdx);
                    }}
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </Card>
              ))}
            </div>
          </div>
        </div>
        <Snackbar
          autoHideDuration={10 * 1000} // 10 seconds
          type={snackBarConfig.type}
          open={snackBarConfig.show}
          onClose={() => setShowSnackbar({ show: false, message: '' })}
          message={snackBarConfig.message}
        />
      </Lane>
    </div>
  );
};

const nameEdit = (props) => (
  <div className={styles['driver-select-container']}>
    <InputField
      {...props}
      onChange={(e) => {
        props.onChange(e.target.value);
      }}
    />
  </div>
)

const TypeAheadEdit = (props) => (
  <div className={styles['driver-select-container']}>
    <DriverTypeahead onChange={(value) => props.onChange(value?.value)} value={props.value}  />
  </div>
)

export const PendingTrips = PendingTripsInternal;
