import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { InputField } from '../../../components/InputField';
import { Select } from '../../../components/Select';
import { changeTripsQuery } from '../../../redux/trips';
import { StatusDropdown } from '../../../containers/StatusDropdown';
import { StateDropdown } from '../../../containers/StateDropdown';

import styles from './TripsFilter.module.css';
import { DriverTypeahead } from '../../../containers/DriverTypeahead';

const FIELDS = [
  { label: 'Status', property: 'TripStatus_id', type: 'status' },
  { label: 'Trip Id', property: 'id', type: 'id' },
  { label: 'Is Active?', property: 'internal_status', type: 'internal_status' },
  { label: 'Driver', property: 'driver_id', type: 'driver' },
  { label: 'Planner', property: 'planner_id', type: 'planner' },
  { label: 'Dispatcher', property: 'dispatcher_id', type: 'dispatcher' },
  { label: 'Origin St', property: 'origin', type: 'state' },
  { label: 'Dest St', property: 'destination', type: 'state' },
  { label: 'Origin Zone', property: 'origin_zone', type: 'zone' },
  { label: 'Dest Zone', property: 'destination_zone', type: 'zone' },
  { label: 'Weight', property: 'weight', type: 'range' },
  { label: 'Active Dates', property: 'planned_date', type: 'date' },
  { label: 'Start Date', property: 'planned_start', type: 'date' },
  { label: 'End Date', property: 'planned_end', type: 'date' },
];

const createInputStyles = (minWidth) => ({
  input: (styles) => ({ ...styles, minWidth }),
  control: (styles) => ({
    ...styles,
    boxShadow: '0 2px 4px 0 rgba(0,0,0,0.2)',
  }),
});


function renderFilterComponentByType(type, args, common_state) {
  const zoneListAsOptions = (common_state.zoneList || [] ).map((zone) => ({ label: zone.zone_description, value: zone.zone_code }));
  const plannerListAsOptions = (common_state.plannersList || [] ).map((planner) => ({ label: `${planner.first_name} ${planner.last_name}`, value: planner.code }));
  const internalStatusAsOptions = [{label: 'yes', value: 'active'} , {label: 'no', value: 'canceled'}]
  const dispatcherOptions = (common_state.dispatcherList || [] ).map((dispatcher) => ({ label: `${dispatcher.first_name} ${dispatcher.last_name}`, value: dispatcher.code }));

  function rangeOnChange(e, index) {
    const val = args.value || [];
    args.onChange([...val.slice(0, index), e.target.value, ...val.slice(index + 1)]);
  }
  switch (type) {
    case 'state':
      return (
        <StateDropdown isMulti placeholder="State" styles={createInputStyles(100)} {...args} value={args.value || []} />
      );
    case 'status':
      return <StatusDropdown isMulti {...args} value={args.value || []} />;
    case 'internal_status':
      return (<Select
        isMulti
        placeholder="Active Status"
        options={internalStatusAsOptions}
        styles={createInputStyles(100)}
        {...args}
        value={args.value || []}
      />);
    case 'zone':
      return (
        <Select
          isMulti
          placeholder="Zone"
          options={zoneListAsOptions}
          styles={createInputStyles(100)}
          {...args}
          value={args.value || []}
        />
      );
    case 'date':
      return (
        <div style={{ display: 'flex' }}>
          <InputField
            {...args}
            value={args.value ? args.value[0] : ''}
            type="date"
            placeholder="from"
            onChange={(e) => rangeOnChange(e, 0)}
          />
          &nbsp;
          <InputField
            {...args}
            value={args.value ? args.value[1] : ''}
            type="date"
            placeholder="to"
            onChange={(e) => rangeOnChange(e, 1)}
          />
        </div>
      );
    case 'range':
      return (
        <div style={{ display: 'flex' }}>
          <InputField
            value={args.value ? args.value[0] : ''}
            type="text"
            placeholder="from"
            onChange={(e) => rangeOnChange(e, 0)}
          />
          &nbsp;
          <InputField
            value={args.value ? args.value[1] : ''}
            type="text"
            placeholder="to"
            onChange={(e) => rangeOnChange(e, 1)}
          />
        </div>
      );
    case 'driver':
      return (
        <DriverTypeahead
          {...args}
          value={args.value || ''}
          onChange={(val) => {
            args.onChange({value: val?.value.id , label: val?.label})
          }}
        />
      );
    case 'planner':
      return (
        <Select
          isMulti
          placeholder="Planner"
          options={plannerListAsOptions}
          styles={createInputStyles(100)}
          {...args}
          value={args.value || []}
        />
      );
    case 'dispatcher':
      return (
        <Select
          isMulti
          placeholder="Dispatcher"
          options={dispatcherOptions}
          styles={createInputStyles(100)}
          {...args}
          value={args.value || []}
        />
      );
    default:
      return (
        <InputField
          {...args}
          value={args.value || ''}
          onChange={(e) => {
            args.onChange(e.target.value);
          }}
        />
      );
  }
}

export function TripsFilter() {
  const dispatch = useDispatch();
  const query = useSelector((state) => state.trips.query);
  const common_state = useSelector(state => state.common);
  const changeQuery = (query) => dispatch(changeTripsQuery(query));
  const clearFilters = (e) => {
    e.stopPropagation();
    dispatch(changeTripsQuery({ filters: {} }));
  };
  const filterLength = Object.keys(query.filters).filter(
    (key) => {
      const val = query.filters[key];
      if (!val) return false;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'object') return Object.keys(val).length > 0;
      return true;
    },
  ).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        Filters{' '}
        {filterLength > 0 && (
          <>
            ({filterLength})
            <a className={styles.link} onClick={clearFilters}>
              Clear
            </a>
          </>
        )}
      </div>
      <div className={`${styles.body}`}>
        {FIELDS.map((field, i) => (
          <div className={styles.filterRow} key={i}>
            <label>{field.label}</label>
            <div className={styles.filterContainer}>
              {renderFilterComponentByType(field.type, {
                value: query.filters[field.property],
                onChange: (value) => {
                  changeQuery({
                    filters: { ...query.filters, [field.property]: value },
                  });
                },
                ...field,
              }, common_state)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
