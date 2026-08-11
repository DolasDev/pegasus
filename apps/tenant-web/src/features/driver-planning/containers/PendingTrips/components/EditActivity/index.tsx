import React, { useState, useRef } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { PopoverShell } from '../../../../components/PopoverShell'
import styles from './EditActivity.module.css'
import { DatePicker } from '../../../../components/DatePicker'
import { useOutsideClick } from '@/features/driver-planning/utils/hooks/use-outside-click'
import { toLocalDateOnly, parseDateOnly } from '@/features/driver-planning/utils/date'
import { Button, IconButton } from '@/features/driver-planning/components/Button'

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
    // planned_start / planned_end are calendar days — send the day the planner
    // picked, not an instant. toISOString() here is what stored 9 prod rows at
    // 05:00 and would land a day early for a client east of UTC.
    editDateSpread({
      start_date: toLocalDateOnly(start) ?? undefined,
      end_date: (toLocalDateOnly(end) || toLocalDateOnly(start)) ?? undefined,
    })
    if (end) {
      closeEditActivity()
    }
  }

  const openDate = parseDateOnly(selectedActivity?.estimated_date) ?? new Date()

  const wrapperRef = useRef<HTMLDivElement>(null)
  useOutsideClick([wrapperRef], () => {
    closeEditActivity()
  })

  return (
    <div ref={wrapperRef}>
      <PopoverShell ref={refs.setFloating} style={floatingStyles}>
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
            Icon={<i className="fas fa-xmark"></i>}
          >
            Clear Dates
          </Button>
        </div>
      </PopoverShell>
    </div>
  )
}
