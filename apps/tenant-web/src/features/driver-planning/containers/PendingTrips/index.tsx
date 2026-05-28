import React, { useState } from 'react'

import { useSelector } from 'react-redux'
import { Link } from '@/features/driver-planning/utils/router-compat'

import { Lane } from '../../components/Lane'
import { Button } from '../../components/Button'

import styles from './PendingTrips.module.css'
import {
  saveTrip as saveTripAction,
  removeShipmentFromTrip,
  editTrip as editTripAction,
  removeActivity as removeActivityAction,
  editActivity as editActivityAction,
  initializeTripPage as clearCurrentTripAction,
  cancelTrip as cancelTripAction,
} from '../../redux/pending-trips'
import { changeShipmentQuery as reloadShipmentsAction } from '../../redux/shipments'
import { Card } from '../../components/Card'
import { TripDetail, DriverTripDetail, NameTripDetail, DispatcherTripDetail } from './TripDetail'
import { InputField } from '../../components/InputField'
import { Snackbar } from '../../components/Snackbar'
import { useConfirm } from '../../components/ConfirmDialog'
import { DriverTypeahead } from '../DriverTypeahead'
import { formatDate } from '../../utils/format-date'
import { AddActivity } from './components/AddActivity'
import { EditActivity } from './components/EditActivity'
import { useFloating, offset } from '@floating-ui/react'
import { Popover } from '@/features/driver-planning/components/Popover'
import type { RootState } from '../../redux/store'
import { useAppDispatch } from '../../redux/hooks'

const createFromToDateString = (startDate: any, endDate: any): string =>
  `${formatDate(startDate)} - ${formatDate(endDate)}`

const createTripString = (trip: any): string =>
  `${trip.shipper_city}, ${trip.shipper_state} - ${trip.consignee_city}, ${trip.consignee_state}`

const getTotalWeight = (shipments: any[]): string =>
  shipments
    .reduce(
      (accumulator: number, current: any) => Number(current.total_est_wt || 0) + accumulator,
      0,
    )
    .toLocaleString()

const getTotalPrice = (shipments: any[]): string =>
  shipments
    .reduce((accumulator: number, current: any) => Number(current.line_haul || 0) + accumulator, 0)
    .toFixed(0)
    .toLocaleString()

const dashboardSettings = {
  title: (shipment: any) => createTripString(shipment),
  children: (shipment: any) =>
    [
      `${shipment.shipper_name}, ${shipment.order_num}, ${shipment.avl_reg}`,
      `Weight: ${shipment.total_est_wt ? `${shipment.total_est_wt?.toLocaleString()}lbs` : 'N/A'} | Linehaul: $${shipment.line_haul?.toLocaleString()}`,
    ].map((str: string, i: number) => <div key={i}>{str}</div>),
}

interface ActivityProps {
  activity: any
  onDelete: () => void
  editActivityDates: (partialActivity: any) => void
}

const Activity: React.FC<ActivityProps> = ({ activity, onDelete, editActivityDates }) => {
  const [editActivity, setEditActivity] = useState(false)
  const [editElement, setEditElement] = useState<HTMLDivElement | null>(null)

  const dispatch = useAppDispatch()

  const openActivityDates = () => {
    if (activity.activityType?.isCanEditDates) {
      setEditActivity(true)
    }
  }

  const closeEditActivity = () => {
    setEditActivity(false)
  }

  const editDateSpread = (dates: any) => {
    editActivityDates({
      //...editActivity,
      planned_start: dates.start_date,
      planned_end: dates.end_date,
    })
  }

  return (
    <>
      <div
        className={styles.activityCard}
        ref={setEditElement}
        onClick={openActivityDates}
        data-target="trip-activity"
        data-activity-abbr={
          activity.activityType?.abbreviation ??
          activity.activityType?.code ??
          activity.ActivityType_code
        }
      >
        <span>{`${activity.activityType?.abbreviation} ${createFromToDateString(activity.planned_start, activity.planned_end)}`}</span>
        <button
          className={`${styles.iconButton} ${styles.floatingDeleteButton}`}
          data-target="remove-activity"
          onClick={(e) => {
            // Don't let the click bubble to the card's openActivityDates handler.
            e.stopPropagation()
            onDelete()
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
        />
      ) : (
        ''
      )}
    </>
  )
}

const MoreTripActions: React.FC<{ tripId: any }> = ({ tripId }) => {
  const { user: planner } = useSelector((state: RootState) => state.user)
  const [isOpen, setOpen] = useState(false)
  const dispatch = useAppDispatch()
  const confirm = useConfirm()
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })

  const cancelTrip = async () => {
    setOpen(false)
    const ok = await confirm({
      title: 'Cancel trip?',
      description: 'Are you sure you want to cancel the trip?',
      confirmLabel: 'Cancel trip',
      cancelLabel: 'Keep trip',
      destructive: true,
    })
    if (ok) {
      dispatch(cancelTripAction(tripId, planner) as any)
      dispatch(reloadShipmentsAction({}))
    }
  }

  return (
    <>
      <Button
        ref={refs.setReference}
        data-target="more-trip-actions"
        onClick={() => setOpen((state) => !state)}
      >
        <i className="fas fa-ellipsis-vertical" />
      </Button>
      {isOpen && (
        <Popover
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            padding: 0,
          }}
        >
          <div className={styles.menu}>
            <div className={styles.menuItem} data-target="cancel-trip" onClick={cancelTrip}>
              Cancel Trip
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}

const PendingTripsInternal = (_props: any) => {
  const { trip: currentTrip } = useSelector((state: RootState) => state.tripPlanning)
  const { user: planner } = useSelector((state: RootState) => state.user)
  const [saveDisabled, setSaveDisabled] = useState(false)
  const confirm = useConfirm()

  const [snackBarConfig, setShowSnackbar] = useState<any>({
    show: false,
    message: '',
  })
  const dispatch = useAppDispatch()

  const { driversMap } = useSelector(
    (state: RootState) => ({
      driversMap: new Map(
        state.common.driversList.map((driver: any) => [driver.driver_id, driver]),
      ),
    }),
    () => false, // only update when remounting
  )

  const removeShipment = (index: number) => {
    dispatch(removeShipmentFromTrip(index))
  }
  const editTrip = (trip: any) => {
    dispatch(editTripAction(trip))
  }

  const removeActivity = (shipmentIndex: number, activityIndex: number) => {
    dispatch(
      removeActivityAction({
        shipmentIndex,
        activityIndex,
      }),
    )
  }

  const editActivity = (shipmentIndex: number, activityIndex: number, partialActivity: any) => {
    dispatch(
      editActivityAction({
        shipmentIndex,
        activityIndex,
        partialActivity,
      }),
    )
  }

  const saveTrip = async (trip: any) => {
    try {
      await dispatch(saveTripAction(trip) as any)
      console.log('Succesfully saved trip')
      setShowSnackbar({
        show: true,
        message: 'Succesfully saved trip',
        type: 'success',
      })
    } catch (e: any) {
      console.log(e)
      setShowSnackbar({
        show: true,
        message: (
          <>
            Failed to save trip! <br /> {e.message}{' '}
          </>
        ),
        type: 'error',
      })
    }
    dispatch(reloadShipmentsAction({}))
    setSaveDisabled(false)
  }

  const clearCurrentTrip = async (_trip: any) => {
    const ok = await confirm({
      title: 'Start a new trip?',
      description: 'Are you sure you want to clear the current trip and start a new one?',
      confirmLabel: 'Start new trip',
    })
    if (ok) {
      dispatch(clearCurrentTripAction(null, planner) as any)
    }
  }

  return (
    <div className={styles.container} data-target="pending-trips">
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
              displayVal={currentTrip.driver?.driver_name || ''}
              placeholder={currentTrip.driver?.driver_name || ''}
              editTrip={editTrip}
              EditComponent={TypeAheadEdit}
            />
            <div className={styles['driver-select-container']} data-target="dispatcher-select">
              <DispatcherTripDetail
                currentTrip={currentTrip}
                label="Dispatcher"
                property="dispatcher"
                editLabel="Change Dispatcher"
                displayVal={
                  currentTrip.dispatcher
                    ? `${currentTrip.dispatcher.first_name} ${currentTrip.dispatcher.last_name}`
                    : ''
                }
                placeholder={
                  currentTrip.dispatcher
                    ? `${currentTrip.dispatcher.first_name} ${currentTrip.dispatcher.last_name}`
                    : ''
                }
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
                EditComponent={(_props: any) => null}
              />
              <TripDetail
                currentTrip={currentTrip}
                label="Total Linehaul"
                editLabel="edit"
                displayVal={`$${getTotalPrice(currentTrip.shipments)}`}
                editTrip={false}
                editable={false}
                EditComponent={(_props: any) => null}
              />
            </div>
            <div className={styles['pending-trip-buttons-container']}>
              {currentTrip.shipments.length > 0 ? (
                <Button
                  color="green"
                  inverted
                  data-target="pending-new-trip"
                  onClick={() => {
                    clearCurrentTrip(currentTrip)
                  }}
                >
                  New Trip
                </Button>
              ) : null}
              <Button
                disabled={saveDisabled}
                data-target="save-trip"
                onClick={() => {
                  setSaveDisabled(true)
                  console.log('saving...')
                  saveTrip(currentTrip)
                }}
              >
                Save
              </Button>
              {currentTrip?.id ? <MoreTripActions tripId={currentTrip?.id} /> : null}
            </div>
            <div className={styles['trip-card-container']}>
              {currentTrip.id && (
                <Link
                  to={`/trip/${currentTrip.id}`}
                  className={styles['title']}
                  data-target="view-itinerary"
                >
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
              {[
                ...currentTrip.shipments.map((shipment: any, idx: number) => ({
                  ...shipment,
                  stateIdx: idx,
                })),
              ]
                .sort((a: any, b: any) => {
                  const aDate = a.load_date ?? ''
                  const bDate = b.load_date ?? ''
                  return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
                })
                .map((shipment: any) => (
                  <Card
                    key={shipment.order_num}
                    title={dashboardSettings.title(shipment)}
                    data-target="pending-trip-shipment"
                    data-order-num={String(shipment.order_num)}
                  >
                    {dashboardSettings.children(shipment)}
                    <div className={styles.activityCreationContainer}>
                      <h3>Activities</h3>
                      <AddActivity shipment={shipment} shipmentIndex={shipment.stateIdx} />
                    </div>
                    {shipment.activities.map((activity: any, activityIndex: number) => (
                      <Activity
                        key={activityIndex}
                        activity={activity}
                        onDelete={() => removeActivity(shipment.stateIdx, activityIndex)}
                        editActivityDates={(partialActivity: any) =>
                          editActivity(shipment.stateIdx, activityIndex, partialActivity)
                        }
                      />
                    ))}
                    <button
                      className={`${styles.iconButton} ${styles.floatingDeleteButton}`}
                      data-target="remove-shipment-from-trip"
                      onClick={() => {
                        removeShipment(shipment.stateIdx)
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
  )
}

const nameEdit = (props: any) => (
  <div className={styles['driver-select-container']}>
    <InputField
      {...props}
      data-target="trip-name-input"
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        props.onChange(e.target.value)
      }}
    />
  </div>
)

const TypeAheadEdit = (props: any) => (
  <div className={styles['driver-select-container']} data-target="driver-typeahead">
    <DriverTypeahead onChange={(value: any) => props.onChange(value?.value)} value={props.value} />
  </div>
)

export const PendingTrips = PendingTripsInternal
