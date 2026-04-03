import React, { useState, useRef } from "react";
import { usePopper } from 'react-popper';
import { Popover } from '../../../../components/Popover';
import  styles  from "./EditActivity.module.css";
import { DatePicker } from '../../../../components/DatePicker';
import { useOutsideClick } from "src/utils/hooks/use-outside-click";
import { Button, IconButton } from "src/components/Button"



export const EditActivity = ({activity, _referenceElement, closeEditActivity, editDateSpread}) => {
  const [selectedActivity, setSelectedActivity] = useState(activity);
  const [referenceElement, setReferenceElement] = useState(_referenceElement);
  const [popperElement, setPopperElement] = useState(null);
  const [arrowElement, setArrowElement] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
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