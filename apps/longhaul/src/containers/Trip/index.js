import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import cn from 'classnames';

import { Lane } from '../../components/Lane';
import { ActivityGantt } from './components/ActivityGantt/ActivityGantt';
import { Notes } from './components/Notes/Notes';
import styles from './Trip.module.css';
import { Button } from '../../components/Button';

import { API } from 'src/utils/api';
import { useStatusPredictionPrompt, promptForStatusUpdate } from './utils/status-prompt';
import { useDateChangePrompt, promptForDateChange } from './utils/date-prompt';
import { TripStatusOptions } from '../../common/trip-status';
import { ShipmentDetail } from '../ShipmentDetail';

import { selectShipment as selectShipmentAction } from '../../redux/shipments';
import { startCase, toLower } from 'lodash';

import { HoverToolTip } from 'src/containers/ToolTips';

const ACTIVITY_TYPE_CODE = {
  PACKING: "PACK",
  PICKUP: "LOAD",
  DELIVERY: "RDEL",
  AGENTPICKUP: "R19I",
  DOCKPICKUP: "R19O",
  WAREHOUSE: "WHSE",
  EXTRAPICKUP: "XPU",
  EXTRADELIVERY: "XDEL",
  UNPACK: "UNPK",
  SITIN: "SITIN",
  SITOUT: "SITOUT"
};

const lastCommaFirst = (first, last) => {
  const first_name = startCase(toLower(first))
  const last_name = startCase(toLower(last))
  return((!!first || !!last) ? `${last_name} , ${first_name}` : 'N/A')
}

const sameDayCheck = (_dayA, _dayB) => {
  const dayA = new Date(_dayA)
  const dayB = new Date(_dayB)
  const dayAsecs = (new Date(dayA.getFullYear(), dayA.getMonth(), dayA.getDate(), 0, 0, 0)).getTime() 
  const dayBsecs = (new Date(dayB.getFullYear(), dayB.getMonth(), dayB.getDate(), 0, 0, 0)).getTime()
  return(dayAsecs === dayBsecs)
}

const getPegDates = (activity) => {
  const shipment = activity.shipment
  let mismatched = false
  const activityPlannedStart = activity.planned_start
  const activityPlannedEnd = activity.planned_end
  let plannedStart = activity.planned_start
  let plannedEnd  = activity.planned_end
  const code = activity.activityType?.code
  switch(code){
    case ACTIVITY_TYPE_CODE.PACKING:
      plannedStart = shipment.pack_date2 || shipment.plan_pack;
      plannedEnd = shipment.plan_pack || shipment.pack_date2;
      mismatched = !(sameDayCheck(activityPlannedStart, plannedStart) && sameDayCheck(activityPlannedEnd, plannedEnd))
      break;
    case ACTIVITY_TYPE_CODE.PICKUP:
      plannedStart = shipment.load_date2 || shipment.plan_load;
      plannedEnd = shipment.plan_load || shipment.load_date2;
      mismatched = !(sameDayCheck(activityPlannedStart, plannedStart) && sameDayCheck(activityPlannedEnd, plannedEnd))
      break;
    case ACTIVITY_TYPE_CODE.DELIVERY:
      plannedStart = shipment.del_date2 || shipment.plan_del;
      plannedEnd = shipment.plan_del || shipment.del_date2;
      mismatched = !(sameDayCheck(activityPlannedStart, plannedStart) && sameDayCheck(activityPlannedEnd, plannedEnd))
      break;
    default:
      mismatched = false
  }
  return({ mismatched: mismatched, plannedStart: plannedStart, plannedEnd: plannedEnd })
}

function datediff(first, second) {
  // Take the difference between the dates and divide by milliseconds per day.
  // Round to nearest whole number to deal with DST.
  return Math.round((second - first) / (1000 * 60 * 60 * 24));
}

function getColor(index) {
  return styles[`color${index + 1}00`];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sortActivities(activities) {
  return activities.slice(0).sort((first, second) => {
    if (!first.planned_end) {
      return 1;
    } else if (!second.planned_end) {
      return -1;
    }
    const diff = new Date(first.actual_date || first.estimated_date || first.planned_start) - new Date(second.actual_date || second.estimated_date || second.planned_start);
    if (diff !== 0) {
      return diff;
    }
    return new Date(first.planned_end) - new Date(second.planned_end);
  });
}

function parseActivities(activities = []) {
  const days = new Set();
  const orderIds = new Set();
  const pushToDays = (unFormatttedDate) => {
    if (unFormatttedDate) {
      const date = new Date(unFormatttedDate).toISOString();
      days.add(date);
    } else {
      days.add(null);
    }
  };
  let hasDateChange = false

  activities.forEach((activity) => {
    const startDate = new Date(activity.planned_start);
    const etaDate = activity.estimated_date; 
    const actualDate = activity.actual_date; 
    const plannedEnd = activity.planned_end ? new Date(activity.planned_end) : startDate;
    const days = datediff(startDate, plannedEnd) || 0;
    const pegDates = getPegDates(activity)
    orderIds.add(activity.order_num);
    pushToDays(activity.planned_start);
    if (etaDate){pushToDays(etaDate);}
    if (actualDate){pushToDays(actualDate);}
    if (pegDates.mismatched){
      activity.hasDateChange = true
      hasDateChange = true
      activity.newStart = pegDates.plannedStart
      activity.newEnd = pegDates.plannedEnd
      const changedDays = datediff(pegDates.plannedStart, pegDates.plannedEnd) || 0;
      pushToDays(pegDates.plannedStart)
      for (let i = 0; i < changedDays; i++) {
        const nextDay = addDays(pegDates.plannedStart, i + 1);
        pushToDays(nextDay);
      }
    }
    for (let i = 0; i < days; i++) {
      const nextDay = addDays(startDate, i + 1);
      pushToDays(nextDay);
    }
  });
  return {
    days: [...days],
    sortedActivities: sortActivities(activities),
    orderIdToColor: [...orderIds].reduce((accum, orderId, i) => ({ ...accum, [orderId]: getColor(i) }), {}),
    hasDateChange: hasDateChange,
  };
}

function TripInternal() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [showError, setShowError] = useState(false);
  const dispatch = useDispatch();

  const selectShipment = useCallback((shipment) => dispatch(selectShipmentAction(shipment)), [dispatch]);

  useEffect(() => {
    async function fetchTrip() {
      try {
      await API.updateTripSummaryInfo(tripId);  
      const trip = await API.fetchTrip(String(tripId));
      setTrip(trip);
      } catch (e) {
        setShowError(e)
      }
    }
    fetchTrip();
  }, [tripId]);

  let sortedActivities = [];
  let days = [];
  let orderIdToColor = null;
  let hasDateChange = false;
  if (trip) {
    const groups = parseActivities(trip.activities);
    days = groups.days;
    sortedActivities = groups.sortedActivities;
    orderIdToColor = groups.orderIdToColor;
    hasDateChange =groups.hasDateChange;
  }

  function reloadTrip() {
    async function fetchTrip() {
      console.time('trip reload')
      const trip = await API.fetchTrip(String(tripId));
      console.timeEnd('trip reload')
      setTrip(trip);
    }
    fetchTrip();
  }

  const changeStatus = async (statusId, status) => {
    console.time('trip status')
    await API.changeTripStatus(trip.id, statusId, status);
    console.timeEnd('trip status')
    reloadTrip();
  };

  const promptAndChangeStatus = (status, status_id) => {
    promptForStatusUpdate(status, () => changeStatus(status_id,status));
  };

  useStatusPredictionPrompt({
    trip,
    changeStatus,
  });


  const updateActivityDates = async () => {
    console.time('trip dates')
    //await API.syncTripDates(trip);
    console.timeEnd('trip dates')
    reloadTrip();
  };

  useDateChangePrompt({
    trip,
    hasDateChange,
    updateActivityDates,
  });

  if (showError) {
    throw showError
  }

  const onUpdateShadow = () => {
    reloadTrip();
  }

  const onUpdateNote = () => {
    reloadTrip();
  }


  return (
    <>
      <ShipmentDetail onUpdateShadow={onUpdateShadow} onUpdateNote={onUpdateNote}/>
      <Lane key="Trip" className={styles.tripContainer} title={trip && trip.driver_name}>
        <div>
          {trip && (
            <>
              <div className={styles.noteContainer}>
                <Notes notes={trip.notes} tripId={trip.id} reloadTrip={reloadTrip} />
              </div>
              <div className={styles.buttonContainer}>
                <Button onClick={() => navigate('/trips')}>
                  <i className="fa fa-arrow-left"></i> All trips
                </Button>
                <Button
                  className={styles.editTripButton}
                  onClick={() => navigate(`/planning?tripId=${tripId}`)}
                >
                  <i className="fa fa-pencil"></i> &nbsp;Edit planning
                </Button>
              </div>
              <div className={` ${styles.headerInfo}`} >
                <span>
                  <b>Trip</b> {`${'#' + trip.id} ${trip.trip_title}` } 
                </span>
                <span>
                  <b>Driver</b> {`${trip.driver ? trip.driver.driver_name : 'Unassigned'}`}
                </span>
                <span>
                  <b>Planner</b> {`${trip.planner ? `${lastCommaFirst(trip.planner.first_name, trip.planner.last_name)}`  : 'N/A'}`}
                </span>
                <span>
                  <b>Dispatcher</b> {`${trip.dispatcher ? `${lastCommaFirst(trip.dispatcher.first_name, trip.dispatcher.last_name)}`  : 'N/A'}`}
                </span>
                <span>
                  <b>Total Est Weight</b> {`${trip.total_estimated_lbs || 'N/A'}`}
                </span>
                <span>
                  <b>Total Actual Weight</b> {`${trip.total_actual_lbs || 'N/A'}`}
                </span>
                <span>
                  <b>Total Est Linehaul</b> {`${trip.total_estimated_linehaul_usd || 'N/A'}`}
                </span>
              </div>
              <div className={styles.summaryContainer}>
                <b>Status</b>
                <div className={styles.statusContainer}>
                  {TripStatusOptions.map(({ status, status_id }, i) => (
                    <div key={i}>
                      <div
                        key={status_id}
                        className={styles.statusStep}
                        onClick={() => promptAndChangeStatus(status, status_id)}
                      >
                        <div
                          className={cn(
                            styles.statusStepCircle,
                            trip.status && trip.status.status === status ? styles.selected : null,
                          )}
                        >
                          {i}
                        </div>
                        {status}
                      </div>
                      {i !== TripStatusOptions.length - 1 ? <div className={styles.statusDivider} /> : null}
                    </div>
                  ))}
                </div>
              </div>
              <h3>Trip Itinerary</h3>
              <div className={styles.dateContainer}>
                <div className={styles.activityContainerFixed}>
                  {sortedActivities.map((activity, index) => {
                    const vipIndicator = activity.shipment.supervip === 'Y' 
                      ? <HoverToolTip key={index} content='Super-VIP Shipper' direction="right"><i style={{'color':'green'}} className="far fa-id-badge"></i></HoverToolTip>
                      : activity.shipment.vip === 'Y'
                        ? <HoverToolTip key={index} content='VIP Shipper' direction="right"><i style={{'color':'purple'}} className="far fa-id-badge"></i></HoverToolTip>
                        : ''
                    return(
                    <div
                      className={styles.activityCard}
                      key={activity.activityId}
                      onClick={(e) => {
                        e.stopPropagation();
                        const shipment = activity.shipment;
                        selectShipment(shipment);
                      }}
                    >
                      <span>{`${startCase(toLower(activity.shipment?.shipper_name.split(", ")[0]))}`}</span><span>{` - ${activity.shipment?.order_num}`}</span> 
                      <div><span>{`${activity.city[0] + activity.city.slice(1).toLowerCase()}, ${activity.state}`}</span><span>{' '}</span><span>{vipIndicator}</span></div>
                      {/*`${activity.shipment?.avl_reg}, ${activity.shipment?.order_num}`*/}

                      
                    </div>
                  )})}
                </div>
                <ActivityGantt
                  reloadTrip={reloadTrip}
                  days={days.sort()}
                  activities={sortedActivities}
                  orderIdToColor={orderIdToColor}
                />
              </div>
            </>
          )}
        </div>
      </Lane>
    </>
  );
}

export const Trip = TripInternal;
