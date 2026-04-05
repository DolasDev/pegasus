
import React from 'react';
import ReactDatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";

export const DatePicker = (props: any) => {
    return (
      <ReactDatePicker
        showPopperArrow={false}
        {...props}
      />
    );
  };
