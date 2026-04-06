import React, { useState, useRef } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { Popover } from '../../../../components/Popover'
import styles from './EditActivity.module.css'
import { DatePicker } from '../../../../components/DatePicker'
import { useOutsideClick } from 'src/utils/hooks/use-outside-click'
import { Button, IconButton } from 'src/components/Button'

interface EditActivityProps {
  activity: any
  _referenceElement: any
  closeEditActivity: () => void
  editDateSpread: (dates: { start_date: string | undefined; end_date: string | undefined }) => void
}

export const EditActivity: React.FC<EditActivityProps> = ({
  activity,
  _referenceElement,
  closeEditActivity,
  editDateSpread,
}) => {
  const [selectedActivity, setSelectedActivity] = useState<any>(activity)
  const [startDate, setStartDate] = useState<any>(null)
  const [endDate, setEndDate] = useState<any>(null)
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })

  const onChange = (dates: any) => {
    const [start, end] = dates
    setStartDate(start)
    setEndDate(end)
    editDateSpread({
      start_date: start?.toISOString(),
      end_date: end?.toISOString() || start?.toISOString(),
    })
    if (end) {
      closeEditActivity()
    }
  }

  const openDate = selectedActivity?.estimated_date
    ? new Date(selectedActivity.estimated_date)
    : new Date()

  const wrapperRef = useRef<HTMLDivElement>(null)
  useOutsideClick([wrapperRef], () => {
    closeEditActivity()
  })

  return (
    <div ref={wrapperRef}>
      <Popover ref={refs.setFloating} style={floatingStyles}>
        <div className={styles.formField}>
          <label htmlFor="estimated_date">Date Spread</label>
          <div>
            <DatePicker
              selected={startDate}
              onChange={onChange}
              startDate={startDate}
              endDate={endDate}
              selectsRange
              inline
              name="estimated_date"
              openToDate={openDate}
            />
          </div>
          <Button
            className={''}
            color={'darkblue'}
            onClick={() => {
              onChange([null, null])
              closeEditActivity()
            }}
            Icon={<i className="fa fa-close"></i>}
          >
            Clear Dates
          </Button>
        </div>
      </Popover>
    </div>
  )
}
