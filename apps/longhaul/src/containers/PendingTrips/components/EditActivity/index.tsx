import React, { useState, useRef } from "react";
import { usePopper } from 'react-popper';
import { Popover } from '../../../../components/Popover';
import  styles  from "./EditActivity.module.css";
import { DatePicker } from '../../../../components/DatePicker';
import { useOutsideClick } from "src/utils/hooks/use-outside-click";
import { Button, IconButton } from "src/components/Button"

interface EditActivityProps {
  activity: any;
  _referenceElement: any;
  closeEditActivity: () => void;
  editDateSpread: (dates: { start_date: string | undefined; end_date: string | undefined }) => void;
}

export const EditActivity: React.FC<EditActivityProps> = ({activity, _referenceElement, closeEditActivity, editDateSpread}) => {
  const [selectedActivity, setSelectedActivity] = useState<any>(activity);
  const [referenceElement, setReferenceElement] = useState<any>(_referenceElement);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);
  const [startDate, setStartDate] = useState<any>(null);
  const [endDate, setEndDate] = useState<any>(null);
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
  });

  const onChange = (dates: any) => {
    const [start, end] = dates;
    setStartDate(start);
    setEndDate(end);
    editDateSpread({
      start_date: start?.toISOString(),
      end_date: end?.toISOString() || start?.toISOString()
    })
    if(end){
      closeEditActivity()
    }
  };

  const openDate = selectedActivity?.estimated_date ? new Date(selectedActivity.estimated_date) : new Date();

  const wrapperRef = useRef<HTMLDivElement>(null);
  useOutsideClick([wrapperRef], () => {
    closeEditActivity()
  });

    return(
    <div ref={wrapperRef}>
      <Popover ref={setPopperElement} style={popperStyles.popper} {...attributes.popper}>
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
              onChange([null,null]);
              closeEditActivity();
            }}
            Icon={<i className="fa fa-close"></i>}
          >Clear Dates</Button>
        </div>
        <div ref={setArrowElement} style={popperStyles.arrow} />
      </Popover>
    </div>
    )
  }
