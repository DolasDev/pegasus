import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import styles from './TripDetail.module.css';
import { useOutsideClick } from "../../utils/hooks/use-outside-click";
import { Select } from '../../components/Select';

export function TripDetail({
  editable = true,
  currentTrip,
  label,
  property,
  editLabel,
  EditComponent,
  editTrip,
  displayVal,
}) {
  const [editMode, setEditMode] = useState(false);
  const [value, setValue] = useState();
  const save = () => {
    setEditMode(false);
    editTrip({ [property]: value });
  };
  const edit = () => {
    setEditMode(true);
  };

  const onChange = () => {
    setValue(value);
    editTrip({ [property]: value });
  };

  useEffect(() => {
    setValue(currentTrip[property]);
  }, [currentTrip, property]);

  return (
    <div className={styles['trip-detail']}>
      {editMode && EditComponent ? (
        <>
          <div className={styles['title']}>{label}</div>
          <EditComponent onChange={onChange} value={value} /> <a onClick={save}>Save</a>
        </>
      ) : (
        <>
          <div className={styles['title']}>{label}</div>
          {displayVal} {editable && <a onClick={edit}>{editLabel}</a>}
        </>
      )}
    </div>
  );
}

export function DriverTripDetail({
  editable = true,
  currentTrip,
  label,
  property,
  editLabel,
  EditComponent,
  editTrip,
  displayVal,
}) {
  const [editMode, setEditMode] = useState(true);
  const [value, setValue] = useState(currentTrip.driver);
  const save = () => {
    setEditMode(false);
    editTrip({ [property]: value });
  };
  const edit = () => {
    setEditMode(true);
  };
  const onChange = (value) => {
    setValue(value);
    //setEditMode(false);
    editTrip({ [property]: value, driver_id : value?.id || null});
  };

  useEffect(() => {
    setValue(currentTrip[property]);
  }, [currentTrip[property]]);

  return (
    <div className={styles['trip-detail']}>
      {editMode && EditComponent ? (
        <>
          <div className={styles['title']}>{label}</div>
          <EditComponent onChange={onChange} value={{ value: value, label: value?.driver_name || '' }} />
        </>
      ) : (
        <>
          <div className={styles['title']}>{label}</div>
          {displayVal} {editable && <a onClick={edit}>{editLabel}</a>}
        </>
      )}
    </div>
  );
}

export function NameTripDetail({
  editable = true,
  currentTrip,
  label,
  property,
  editLabel,
  EditComponent,
  editTrip,
  displayVal,
  editVal,
}) {
  const [editMode, setEditMode] = useState(true);
  const [value, setValue] = useState(editVal);
  const [actualEditMode, setActualEditMode] = useState(false);

  const save = () => {
    setEditMode(true);
    editTrip({ [property]: value });
  };
  const edit = () => {
    setEditMode(true);
  };

  const onChange = (value) => {
    setValue(value);
    setActualEditMode(true)
  };

  const wrapperRef = useRef(null);
  
  useOutsideClick([wrapperRef], () => {
    if(actualEditMode){
      editTrip({ [property]: value })
      setActualEditMode(!actualEditMode)
    }
  });

  useEffect(() => {
    setValue(currentTrip[property] || 'Pending Trip');
  }, [currentTrip, property]);


  return (
    <div ref={wrapperRef} className={styles['trip-detail']}>
      {editMode && EditComponent ? (
        <>
          <div className={styles['title']}>{label}</div>
          <EditComponent onChange={onChange} value={value} />
        </>
      ) : (
        <>
          <div className={styles['title']}>{label}</div>
          {displayVal} {editable && <a onClick={edit}>{editLabel}</a>}
        </>
      )}
    </div>
  );
}

export function DispatcherTripDetail({
  editable = true,
  currentTrip,
  label,
  property,
  editLabel,
  EditComponent,
  editTrip,
  displayVal,
}) {
  const [editMode, setEditMode] = useState(true);
  const [value, setValue] = useState();
  const onChange = (value) => {
    setDispatcher(value?.value);
    editTrip({ [property]: value?.value, dispatcher_id: value?.value.code || null});
  };

  useEffect(() => {
    setDispatcher(currentTrip[property]);
  }, [currentTrip[property]]);

  const common_state = useSelector(state => state.common);
  const dispatcherListAsOptions = (common_state.dispatcherList || [] ).map((dispatcher) => ({ label: `${dispatcher.first_name} ${dispatcher.last_name}`, value: dispatcher }));
  const [dispatcher, setDispatcher] = useState(currentTrip.dispatcher || null)
  
  return (
    <div className={styles['trip-detail']}>
      <div className={styles['title']}>{label}</div>
        <Select
            placeholder="Planner"
            defaultValue={null}
            options={dispatcherListAsOptions}
            value={ dispatcher?.code ? {value: dispatcher ,  label: `${dispatcher.first_name || ''} ${dispatcher.last_name || ''} `} : {value:null, label:''}}
            onChange={onChange}
          /> 
    </div>
  );
}
