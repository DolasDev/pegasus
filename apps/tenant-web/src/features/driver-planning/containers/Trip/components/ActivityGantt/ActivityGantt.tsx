import React, { useState } from 'react'
import { useFloating, offset } from '@floating-ui/react'

import styles from './ActivityGantt.module.css'
import { formatDateShort } from '../../../../utils/format-date'
import { toUtcDayKey } from '../../../../utils/date'
import { PopoverShell } from '../../../../components/PopoverShell'
import { DatePicker } from '../../../../components/DatePicker'
import { updateActivityForTrip } from '../../../../redux/trips'
import { Button } from '../../../../components/Button'
import { HoverToolTip } from '../../../ToolTips'
import { useAppDispatch } from '../../../../redux/hooks'

function ActivityHeader({ date }: { date: string }) {
  return (
    <div className={styles.dateHeader}>
      <h5>{date}</h5>
    </div>
  )
}

function datediff(first: any, second: any): number {
  // Take the difference between the dates and divide by milliseconds per day.
  // Round to nearest whole number to deal with DST.
  return Math.round((second - first) / (1000 * 60 * 60 * 24))
}

function getTotalDays(activity: any): number {
  const startDate = new Date(activity.planned_start)
  const plannedEnd = activity.planned_end ? new Date(activity.planned_end) : startDate
  return (datediff(startDate, plannedEnd) || 0) + 1
}

function getOffset(targetDay: any, days: any[]): number {
  // `days` is keyed by UTC-midnight day key (see parseActivities) — normalize
  // the lookup the same way. Matching on the raw timestamp missed whenever the
  // value carried a different time-of-day than the one that seeded the column,
  // and the -1 fallback below silently parked the bar in the first column.
  const index = days.indexOf(toUtcDayKey(targetDay))
  if (index === -1) {
    // default to offset of 0
    return 0
  }
  return index
}

export function ActivityGantt({ days, activities, orderIdToColor, reloadTrip, readOnly }: any) {
  const [selectedActivity, setSelectedActivity] = useState<any>(null)
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })

  const dispatch = useAppDispatch()

  const onActivityClick = (activity: any) => {
    // Rejected-trip view is read-only — never open the date-edit popover (which
    // would otherwise write back to the ORIGINAL live trip's activities).
    if (readOnly) return
    setSelectedActivity(() => (selectedActivity === activity.activityId ? null : activity))
  }

  const updateActivity = async (partialActivity: any) => {
    // optimistically update
    setSelectedActivity((activity: any) => ({
      ...activity,
      ...partialActivity,
    }))
    // TODO redux patch

    /**
     * const updatedActivity = patchActit(newActivty)
     * setSelectedActivity(updatedActivity)
     */
  }
  const syncActivityDates = async () => {
    const partialActivity = {
      TripMaster_id: selectedActivity.TripMaster_id,
      planned_start: selectedActivity.newStart,
      planned_end: selectedActivity.newEnd,
    }
    await dispatch(updateActivityForTrip(selectedActivity.activityId, partialActivity) as any)
    reloadTrip()
  }

  const saveActivity = async () => {
    const partialActivity = {
      TripMaster_id: selectedActivity.TripMaster_id,
      estimated_date: selectedActivity.estimated_date,
      actual_date: selectedActivity.actual_date,
      is_committed: selectedActivity.is_committed,
      is_confirmed: selectedActivity.is_confirmed,
    }
    await dispatch(updateActivityForTrip(selectedActivity.activityId, partialActivity) as any)
    reloadTrip()
  }

  const etaDate = selectedActivity?.estimated_date
    ? new Date(selectedActivity.estimated_date)
    : null
  const actualDate = selectedActivity?.actual_date ? new Date(selectedActivity.actual_date) : null
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  // `openToDate` is the calendar's initial focus month/day. When it's an
  // Invalid Date (because planned_start is null/blank/malformed for this
  // activity) react-datepicker silently snaps the focus to `maxDate`, which
  // for the Actual-Date picker is `tomorrow` — so every fresh popover was
  // landing the user on tomorrow's cell instead of the activity's window.
  // Fall back to today when planned_start can't be parsed.
  const safeStartDate = (() => {
    if (!selectedActivity?.planned_start) return new Date()
    const d = new Date(selectedActivity.planned_start)
    return Number.isNaN(d.getTime()) ? new Date() : d
  })()

  return (
    <>
      <div className={styles.activityGantt} data-target="activity-gantt">
        <div className={styles.header}>
          {days.map((day: any, i: any) => (
            <ActivityHeader
              key={day}
              date={day === null ? 'Unknown' : formatDateShort(day) || ''}
            />
          ))}
        </div>
        {activities.map((activity: any) => {
          const isOrderSelected =
            selectedActivity && selectedActivity.order_num === activity.order_num
          const isSelectedActivity =
            selectedActivity && selectedActivity.activityId === activity.activityId
          return (
            <div
              className={styles.activityRow}
              key={activity.activityId}
              data-target="gantt-activity-row"
              data-activity-id={String(activity.activityId)}
              data-order-num={String(activity.order_num)}
              data-activity-abbr={
                activity.activityType?.abbreviation ??
                activity.activityType?.code ??
                activity.ActivityType_code
              }
            >
              <div className={styles.fakeRow}>
                {days.map((day: any, i: any) => (
                  <div key={i} className={styles.dateColumn} />
                ))}
              </div>
              <ActivityRow
                className={`${orderIdToColor[activity.order_num]} ${
                  selectedActivity && !isOrderSelected ? styles['not-selected'] : ''
                }`}
                activity={activity}
                onClick={() => onActivityClick(activity)}
                days={days}
                ref={isSelectedActivity ? refs.setReference : null}
              />
            </div>
          )
        })}

        {/** Activity popper */}
      </div>
      {selectedActivity && (
        <PopoverShell ref={refs.setFloating} style={floatingStyles}>
          {selectedActivity.hasDateChange ? (
            <>
              <button
                className="pegasus-link"
                style={{ position: 'absolute', top: '1px', right: '2px' }}
                onClick={() => {
                  setSelectedActivity(null)
                }}
              >
                close
              </button>
              <Button
                onClick={(e: any) => {
                  syncActivityDates()
                  setSelectedActivity(null)
                }}
              >
                Update Itinerary Dates
              </Button>
            </>
          ) : (
            <>
              <button
                className="pegasus-link"
                style={{ position: 'absolute', bottom: '5px', right: '5px' }}
                onClick={() => {
                  saveActivity()
                  setSelectedActivity(null)
                }}
              >
                save
              </button>
              <button
                className="pegasus-link"
                style={{ position: 'absolute', top: '5px', right: '5px' }}
                onClick={() => {
                  setSelectedActivity(null)
                }}
              >
                close
              </button>

              {selectedActivity.activityType?.isHasETA && (
                <div className={styles.formField}>
                  <label htmlFor="estimated_date">Estimated Date</label>
                  <div>
                    <DatePicker
                      //minDate={new Date(selectedActivity.planned_start)}
                      //maxDate={new Date(selectedActivity.planned_end)}
                      name="estimated_date"
                      selected={etaDate}
                      onChange={(date: any) => {
                        updateActivity({ estimated_date: date ? date.toISOString() : null })
                      }}
                      openToDate={etaDate ? etaDate : safeStartDate}
                      isClearable={true}
                    />

                    {/*selectedActivity.estimated_date ? (
                            <span >
                            <Button
                                className={
                                  `${styles.confirmDateButton}
                                  ${selectedActivity.is_committed ? styles.confirmed : ''}`
                                }
                                onClick={
                                  () => {
                                    updateActivity({is_committed: selectedActivity.is_committed ? false : true})
                                  }
                                }
                              >
                                <HoverToolTip content='Driver has Committed?' direction="right">
                                <i className={selectedActivity.is_committed ? 'fas fa-check' : 'fas fa-question' }></i>
                                </HoverToolTip>
                              </Button>
                            </span>
                          ) : '' */}

                    {selectedActivity.estimated_date ? (
                      <span>
                        <Button
                          className={`${styles.confirmDateButton}
                                  ${selectedActivity.is_confirmed ? styles.confirmed : ''}`}
                          onClick={() => {
                            updateActivity({
                              is_confirmed: selectedActivity.is_confirmed ? false : true,
                            })
                          }}
                        >
                          <HoverToolTip content="Confirmed with Driver" direction="right">
                            <i
                              className={
                                selectedActivity.is_confirmed
                                  ? 'fas fa-flag-checkered'
                                  : 'fas fa-question'
                              }
                            ></i>
                          </HoverToolTip>
                        </Button>
                      </span>
                    ) : (
                      ''
                    )}
                  </div>
                </div>
              )}
              {selectedActivity.is_confirmed || !selectedActivity.activityType?.isHasETA ? (
                <div className={styles.formField}>
                  <label htmlFor="estimated_date">Actual Date</label>
                  <div>
                    <HoverToolTip content="Confirm Actualized Date" direction="right">
                      <DatePicker
                        //minDate={new Date(selectedActivity.planned_start)}
                        maxDate={tomorrow}
                        name="actual_date"
                        selected={actualDate}
                        onChange={(date: any) => {
                          updateActivity({ actual_date: date ? date.toISOString() : null })
                        }}
                        openToDate={actualDate ? actualDate : safeStartDate}
                      />
                    </HoverToolTip>
                  </div>
                </div>
              ) : (
                ''
              )}
            </>
          )}
        </PopoverShell>
      )}
    </>
  )
}

function getFormattedWeight(weight: any): string {
  if (typeof weight === 'number') {
    return `${Math.round(weight / 1000)}k`
  }
  return 'N/A'
}

interface ActivityRowProps {
  activity: any
  onClick: () => void
  className: string
  days: any[]
}

const ActivityRow = React.forwardRef<HTMLDivElement, ActivityRowProps>(
  ({ activity, onClick, className, days }, ref) => {
    const width = 80
    const padding = 10
    const numberOfDays = getTotalDays(activity)
    const offset = getOffset(activity.planned_start, days)
    const etaDate = activity.actual_date
      ? new Date(activity.actual_date)
      : activity.estimated_date
        ? new Date(activity.estimated_date)
        : null
    const etaOffset = getOffset(etaDate, days) - offset
    const isEtaSet = !!etaDate
    const hasDateChange = activity.hasDateChange
    const newNumberOfDays = hasDateChange
      ? (datediff(activity.newStart, activity.newEnd) || 0) + 1
      : 0
    const newOffset = hasDateChange ? getOffset(activity.newStart, days) : 0

    const innerContent = (
      <>
        <div>
          <span>
            {activity.activityType?.abbreviation}{' '}
            {`${getFormattedWeight(activity?.shipment?.pegasus_shadow?.weight || activity?.shipment?.total_est_wt)} `}
          </span>
          <HoverToolTip
            content={
              activity.actual_date
                ? `Verified Complete`
                : activity.is_confirmed
                  ? `Confirmed With Driver`
                  : activity.is_committed
                    ? `Driver Commitment Made`
                    : ''
            }
            direction="right"
          >
            <i
              className={
                activity.actual_date
                  ? `fas fa-truck-moving ${styles.green}`
                  : activity.is_confirmed
                    ? `fas fa-flag-checkered ${styles.green}`
                    : activity.is_committed
                      ? `fas fa-check ${styles.green}`
                      : ''
              }
            ></i>
          </HoverToolTip>
        </div>
        <div>
          <span>{`${activity.state}`}</span>
          <></>
        </div>
      </>
    )

    return (
      <>
        <div
          onClick={onClick}
          className={`${styles.activity} ${className}`}
          style={{
            width: width * numberOfDays + padding * 2 * (numberOfDays - 1),
            left: (width + 1 + padding * 2) * offset + padding,
          }}
        >
          {isEtaSet ? (
            <div
              ref={ref}
              className={`${styles.eta} ${className}`}
              style={{
                width: width,
                left: (width + 1 + padding * 2) * etaOffset,
              }}
            >
              {innerContent}
            </div>
          ) : (
            <div ref={ref}>{innerContent}</div>
          )}
        </div>

        {hasDateChange ? (
          <div
            onClick={onClick}
            className={`${styles.activity} ${className} ${styles['date-change']}`}
            style={{
              width: width * newNumberOfDays + padding * 2 * (newNumberOfDays - 1),
              left: (width + 1 + padding * 2) * newOffset + padding,
            }}
          >
            <div ref={ref}>
              <div>
                <span>{`New Dates!`}</span>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  },
)
