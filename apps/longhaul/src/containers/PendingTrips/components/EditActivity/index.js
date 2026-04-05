import React, { useState, useRef } from "react";
import { useFloating, offset } from '@floating-ui/react';
import { Popover } from '../../../../components/Popover';
import  styles  from "./EditActivity.module.css";
import { DatePicker } from '../../../../components/DatePicker';
import { useOutsideClick } from "src/utils/hooks/use-outside-click";
import { Button, IconButton } from "src/components/Button"



export const EditActivity = ({activity, _referenceElement, closeEditActivity, editDateSpread}) => {
  const [selectedActivity, setSelectedActivity] = useState(activity);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const { refs, floatingStyles } = useFloating({
    elements: { reference: _referenceElement },
    middleware: [offset(5)],
  });

  const onChange = dates => {
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

  const wrapperRef = useRef(null);
  useOutsideClick([wrapperRef], () => {
    closeEditActivity()
  });
  
    return(
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
              onChange([null,null]);
              closeEditActivity();
            }}
            Icon={<i className="fa fa-close"></i>}
          >Clear Dates</Button>
        </div>
      </Popover>
    </div>
    )
  }