import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from '@/features/driver-planning/utils/router-compat'
import { clsx as cn } from 'clsx'

import { Lane } from '../../components/Lane'
import { ActivityGantt } from './components/ActivityGantt/ActivityGantt'
import { Notes } from './components/Notes/Notes'
import styles from './Trip.module.css'
import { Button } from '../../components/Button'
import { RateTripButton } from '../../components/RateTripButton'

import { API } from '@/features/driver-planning/utils/api'
import { useStatusPredictionPrompt, usePromptForStatusUpdate } from './utils/status-prompt'
import { useDateChangePrompt } from './utils/date-prompt'
import { TripStatusOptions } from '../../common/trip-status'
import { ShipmentDetail } from '../ShipmentDetail'

import { selectShipment as selectShipmentAction } from '../../redux/shipments'
import { lastCommaFirst, startCase } from '@/features/driver-planning/utils/string'
import { parseActivities } from './utils/parse-activities'

import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'
import { useAppDispatch } from '../../redux/hooks'

function getColor(index: number): string {
  return styles[`color${index + 1}00`]
}

function TripInternal() {
  // The rejected-trip view reuses this component via the
  // /driver-planning/trips/rejected/$rejectedId route. When `rejectedId` is
  // present we load an immutable Postgres snapshot and render read-only — no
  // status changes, no activity/notes edits, no "Edit planning".
  const { tripId, rejectedId } = useParams<{ tripId?: string; rejectedId?: string }>()
  const isRejected = Boolean(rejectedId)
  const navigate = useNavigate()
  const [trip, setTrip] = useState<any>(null)
  const [showError, setShowError] = useState<any>(false)
  const dispatch = useAppDispatch()

  const selectShipment = useCallback(
    (shipment: any) => dispatch(selectShipmentAction(shipment) as any),
    [dispatch],
  )

  useEffect(() => {
    async function fetchTrip() {
      try {
        if (isRejected) {
          const trip = await API.fetchRejectedTrip(String(rejectedId))
          setTrip(trip)
          return
        }
        await API.updateTripSummaryInfo(Number(tripId))
        const trip = await API.fetchTrip(Number(tripId))
        setTrip(trip)
      } catch (e: any) {
        setShowError(e)
      }
    }
    fetchTrip()
  }, [tripId, rejectedId, isRejected])

  let sortedActivities: any[] = []
  let days: any[] = []
  let orderIdToColor: any = null
  let hasDateChange = false
  if (trip) {
    const groups = parseActivities(trip.activities, getColor)
    days = groups.days
    sortedActivities = groups.sortedActivities
    orderIdToColor = groups.orderIdToColor
    hasDateChange = groups.hasDateChange
  }

  function reloadTrip() {
    async function fetchTrip() {
      console.time('trip reload')
      const trip = isRejected
        ? await API.fetchRejectedTrip(String(rejectedId))
        : await API.fetchTrip(Number(tripId))
      console.timeEnd('trip reload')
      setTrip(trip)
    }
    fetchTrip()
  }

  const changeStatus = async (statusId: any, status: any) => {
    console.time('trip status')
    await API.changeTripStatus(trip.id, statusId, status)
    console.timeEnd('trip status')
    reloadTrip()
  }

  const promptForStatusUpdate = usePromptForStatusUpdate()
  const promptAndChangeStatus = (status: any, status_id: any) => {
    promptForStatusUpdate(status, trip.status?.status, () => changeStatus(status_id, status))
  }

  useStatusPredictionPrompt({
    // Disabled in rejected (read-only) mode — these prompts would offer to
    // mutate a live trip. Both hooks no-op when trip is falsy.
    trip: isRejected ? null : trip,
    changeStatus,
  })

  const updateActivityDates = async () => {
    console.time('trip dates')
    //await API.syncTripDates(trip);
    console.timeEnd('trip dates')
    reloadTrip()
  }

  useDateChangePrompt({
    trip: isRejected ? null : trip,
    hasDateChange,
    updateActivityDates,
  })

  if (showError) {
    throw showError
  }

  const onUpdateShadow = () => {
    reloadTrip()
  }

  const onUpdateNote = () => {
    reloadTrip()
  }

  return (
    <>
      <ShipmentDetail onUpdateShadow={onUpdateShadow} onUpdateNote={onUpdateNote} />
      <Lane key="Trip" className={styles.tripContainer} title={trip && trip.driver_name}>
        <div>
          {trip && (
            <>
              <div className={styles.noteContainer}>
                <Notes
                  notes={trip.notes}
                  tripId={trip.id}
                  reloadTrip={reloadTrip}
                  readOnly={isRejected}
                />
              </div>
              <div className={styles.buttonContainer}>
                <Button data-target="trip-back-to-trips" onClick={() => navigate('/trips')}>
                  <i className="fas fa-arrow-left"></i> All trips
                </Button>
                <RateTripButton shipments={trip.shipments} />
                {!isRejected && (
                  <Button
                    className={styles.editTripButton}
                    data-target="trip-edit-planning"
                    onClick={() => navigate(`/planning?tripId=${tripId}`)}
                  >
                    <i className="fas fa-pencil"></i> &nbsp;Edit planning
                  </Button>
                )}
              </div>
              {isRejected && (
                <div className={styles.headerInfo} data-target="rejected-trip-banner">
                  <span>
                    <b>Rejected Trip</b> (read-only copy
                    {trip.createdAt
                      ? ` — saved ${new Date(trip.createdAt).toLocaleDateString()}`
                      : ''}
                    )
                  </span>
                  {(trip.rejection?.drivers ?? []).map((d: any) => (
                    <span key={d.driverId} data-target="rejected-trip-driver">
                      <b>{d.driverName || `Driver ${d.driverId}`}</b>
                      {d.reason ? `: ${d.reason}` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div className={` ${styles.headerInfo}`}>
                <span>
                  <b>Trip</b> {`${'#' + trip.id} ${trip.trip_title}`}
                </span>
                <span>
                  <b>Driver</b> {`${trip.driver ? trip.driver.driver_name : 'Unassigned'}`}
                </span>
                <span>
                  <b>Planner</b>{' '}
                  {`${trip.planner ? `${lastCommaFirst(trip.planner.first_name, trip.planner.last_name)}` : 'N/A'}`}
                </span>
                <span>
                  <b>Dispatcher</b>{' '}
                  {`${trip.dispatcher ? `${lastCommaFirst(trip.dispatcher.first_name, trip.dispatcher.last_name)}` : 'N/A'}`}
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
                <div className={styles.statusContainer} data-target="trip-status">
                  {TripStatusOptions.map(({ status, status_id }: any, i: number) => (
                    <div key={i}>
                      <div
                        key={status_id}
                        className={styles.statusStep}
                        data-target="trip-status-step"
                        data-status={status}
                        data-active={
                          trip.status && trip.status.status === status ? 'true' : 'false'
                        }
                        style={isRejected ? { cursor: 'default' } : undefined}
                        onClick={() => {
                          if (isRejected) return
                          promptAndChangeStatus(status, status_id)
                        }}
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
                      {i !== TripStatusOptions.length - 1 ? (
                        <div className={styles.statusDivider} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <h3>Trip Itinerary</h3>
              <div className={styles.dateContainer}>
                <div className={styles.activityContainerFixed}>
                  {sortedActivities.map((activity: any, index: number) => {
                    const vipIndicator =
                      activity.shipment.supervip === 'Y' ? (
                        <HoverToolTip key={index} content="Super-VIP Shipper" direction="right">
                          <i style={{ color: 'green' }} className="far fa-id-badge"></i>
                        </HoverToolTip>
                      ) : activity.shipment.vip === 'Y' ? (
                        <HoverToolTip key={index} content="VIP Shipper" direction="right">
                          <i style={{ color: 'purple' }} className="far fa-id-badge"></i>
                        </HoverToolTip>
                      ) : (
                        ''
                      )
                    return (
                      <div
                        className={styles.activityCard}
                        key={activity.activityId}
                        data-target="trip-shipment-activity"
                        data-order-num={String(activity.shipment?.order_num)}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation()
                          if (isRejected) return
                          const shipment = activity.shipment
                          selectShipment(shipment)
                        }}
                      >
                        <span>{`${startCase(activity.shipment?.shipper_name.split(', ')[0].toLowerCase())}`}</span>
                        <span>{` - ${activity.shipment?.order_num}`}</span>
                        <div>
                          <span>{`${activity.city[0] + activity.city.slice(1).toLowerCase()}, ${activity.state}`}</span>
                          <span> </span>
                          <span>{vipIndicator}</span>
                        </div>
                        {/*`${activity.shipment?.avl_reg}, ${activity.shipment?.order_num}`*/}
                      </div>
                    )
                  })}
                </div>
                <ActivityGantt
                  reloadTrip={reloadTrip}
                  days={days.sort()}
                  activities={sortedActivities}
                  orderIdToColor={orderIdToColor}
                  readOnly={isRejected}
                />
              </div>
            </>
          )}
        </div>
      </Lane>
    </>
  )
}

export const Trip = TripInternal
