import React, { useState } from 'react'
import { usePopper } from 'react-popper'
import { useDispatch } from 'react-redux'
import { clsx } from 'clsx'
import { CircularButton as CircularButtonTyped } from '../../../../components/Button'
import { Popover as PopoverTyped } from '../../../../components/Popover'
import { ActivityType } from '../../../../utils/constants/activity-type'
import { addActivity as addActivityAction } from '../../../../redux/pending-trips'
import styles from './AddActivity.module.css'

const Popover = PopoverTyped as any
const CircularButton = CircularButtonTyped as any

interface PartialShipment {
  order_num: number
  planned_start: Date
  planned_end: Date
  extraActivities: any
}

interface AddActivityProps {
  shipment: PartialShipment
  shipmentIndex: number
}

export const AddActivity: React.FC<AddActivityProps> = ({ shipment, shipmentIndex }) => {
  const [menuIsOpen, setMenuState] = useState(false)
  const [referenceElement, setReferenceElement] = useState(null)
  const [popperElement, setPopperElement] = useState(null)
  const [arrowElement, setArrowElement] = useState(null)
  const dispatch = useDispatch<any>()
  const { styles: popperStyles, attributes } = usePopper(referenceElement, popperElement, {
    modifiers: [
      { name: 'arrow', options: { element: arrowElement } },
      {
        name: 'offset',
        options: {
          offset: [0, 5],
        },
      },
    ],
  })
  const toggleMenu = () => {
    setMenuState((state) => !state)
  }

  const addActivity = (activity: any, activityIdx: Number) => {
    toggleMenu()

    dispatch(
      addActivityAction({
        shipmentIndex: shipmentIndex,
        activity: activity,
        activityIdx: activityIdx,
      }),
    )
  }

  const extraActivities: any[] = shipment.extraActivities

  return (
    <div className={styles.addActivityContainer}>
      <CircularButton
        ref={setReferenceElement}
        onClick={toggleMenu}
        className={clsx(styles.addActivityButton, menuIsOpen ? styles.closeAddActivityButton : null)}
      >
        {menuIsOpen ? '-' : '+'}
      </CircularButton>
      {menuIsOpen && (
        <Popover
          ref={setPopperElement}
          style={{
            ...popperStyles.popper,
            padding: 0,
          }}
          {...attributes.popper}
        >
          <div className={styles.menu}>
            {(extraActivities || []).map((activity, idx) => (
              <div
                onClick={() => addActivity(activity, idx)}
                className={styles.menuItem}
                key={activity.ActivityType_code}
              >
                {activity.activityType?.abbreviation}
              </div>
            ))}
          </div>
          <div ref={setArrowElement as any} style={popperStyles.arrow} />
        </Popover>
      )}
    </div>
  )
}
