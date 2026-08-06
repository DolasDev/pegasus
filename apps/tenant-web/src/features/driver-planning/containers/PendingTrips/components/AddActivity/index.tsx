import React, { useState } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { useDispatch } from 'react-redux'
import { clsx } from 'clsx'
import { CircularButton as CircularButtonTyped } from '../../../../components/Button'
import { PopoverShell as PopoverShellTyped } from '../../../../components/PopoverShell'
import { ActivityType } from '../../../../utils/constants/activity-type'
import { addActivity as addActivityAction } from '../../../../redux/trip-planning'
import styles from './AddActivity.module.css'
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

const PopoverShell = PopoverShellTyped as any
const CircularButton = CircularButtonTyped as any

interface AddActivityProps {
  /**
   * Was a local `PartialShipment` declaring `order_num`, `planned_start` and
   * `planned_end` — the last two are ACTIVITY fields, not columns on
   * v_longhaul_shipments_v2, and none of the three was ever read here. Only
   * `extraActivities` is.
   */
  shipment: LonghaulShipmentRow
  shipmentIndex: number
}

export const AddActivity: React.FC<AddActivityProps> = ({ shipment, shipmentIndex }) => {
  const [menuIsOpen, setMenuState] = useState(false)
  const dispatch = useDispatch<any>()
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })
  const toggleMenu = () => {
    setMenuState((state) => !state)
  }

  const addActivity = (activity: any, activityIdx: number) => {
    toggleMenu()

    dispatch(
      addActivityAction({
        shipmentIndex: shipmentIndex,
        activity: activity,
        activityIdx: activityIdx,
      }),
    )
  }

  const extraActivities: any[] = shipment.extraActivities ?? []

  return (
    <div className={styles.addActivityContainer}>
      <CircularButton
        ref={refs.setReference}
        onClick={toggleMenu}
        data-target="add-activity"
        className={clsx(
          styles.addActivityButton,
          menuIsOpen ? styles.closeAddActivityButton : null,
        )}
      >
        {menuIsOpen ? '-' : '+'}
      </CircularButton>
      {menuIsOpen && (
        <PopoverShell
          ref={refs.setFloating}
          style={{
            ...floatingStyles,
            padding: 0,
          }}
        >
          <div className={styles.menu}>
            {(extraActivities || []).map((activity, idx) => (
              <div
                onClick={() => addActivity(activity, idx)}
                className={styles.menuItem}
                data-target="add-activity-option"
                data-activity-abbr={activity.activityType?.abbreviation}
                key={activity.ActivityType_code}
              >
                {activity.activityType?.abbreviation}
              </div>
            ))}
          </div>
        </PopoverShell>
      )}
    </div>
  )
}
