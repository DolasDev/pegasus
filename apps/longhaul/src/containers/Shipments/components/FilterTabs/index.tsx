import React, { useState } from 'react';
import { InputField } from '../../../../components/InputField';
import { Select } from '../../../../components/Select';
import SaveFilterModal from './SaveFilterModal';
import FilterModal from './FilterModal';
import { SHAUL_LIST } from '../../../../utils/shaul-list';
import { HAULMODE_LIST } from '../../../../utils/haulmode-list';
import { ASSIGNED_LIST } from '../../../../utils/unassigned-list';
import styles from './CollapsibleFilters.module.css';
import { changeShipmentQuery, resetToDefaultShipmentQuery } from '../../../../redux/shipments';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../../../redux/store';

const shortHaulAsOptions = SHAUL_LIST;
const haulModeAsOptions = HAULMODE_LIST;
const assignedAsOptions = ASSIGNED_LIST;

const FIELDS = [
  { label: 'Origin St', property: 'origin', type: 'state' },
  { label: 'Dest St', property: 'destination', type: 'state' },
  { label: 'Origin Zone', property: 'origin_zone', type: 'zone' },
  { label: 'Dest Zone', property: 'destination_zone', type: 'zone' },
  { label: 'Pack', property: 'pack_date', type: 'date' },
  { label: 'Load', property: 'load_date', type: 'date' },
  { label: 'Del', property: 'delivery_date', type: 'date' },
  { label: 'Weight', property: 'weight', type: 'range' },
  { label: 'Mileage', property: 'mileage', type: 'range' },
  { label: 'Short Haul', property: 'short_haul', type: 'short-haul' },
  { label: 'Move Types', property: 'move_type', type: 'move-type' },
  { label: 'Haul Mode', property: 'shaul', type: 'haul-mode' },
  { label: 'Assigned', property: 'assigned', type: 'assigned' },
  { label: 'Dispatcher', property: 'operations_id', type: 'dispatcher' },
  { label: 'Trip Status', property: 'TripStatus_id', type: 'trip-status' },
];

const createInputStyles = (minWidth: any) => ({
  input: (s: any) => ({ ...s, minWidth }),
  control: (s: any) => ({
    ...s,
    boxShadow: '0 2px 4px 0 rgba(0,0,0,0.2)',
  }),
});

function renderFilterComponentByType(type: any, args: any, common_state: any) {
  const stateListAsOptions = (common_state.stateList || [] ).map((state: any) => ({ label: `${state.geo_name} ${state.geo_code}`, value: state.geo_code }));
  const TripStatusAsOptions = (common_state.tripStatuses || [] ).map((status: any) => ({ label: status.status, value: status.status_id }));
  const zoneListAsOptions = (common_state.zoneList || [] ).map((zone: any) => ({ label: zone.zone_description, value: zone.zone_code }));
  const filterOptions = common_state.filterOptions;
  const dispatcherOptions = (common_state.dispatcherList || [] ).map((dispatcher: any) => ({ label: `${dispatcher.first_name} ${dispatcher.last_name}`, value: dispatcher.code }));

  const date = new Date();
  date.setHours(0, 0, 0, 0);

  const daysBetween = (date1: any, date2: any) => {
    const ONE_DAY = 1000 * 60 * 60 * 24;
    const differenceMs = Math.abs(+new Date(date1) - +new Date(date2));
    return Math.round(differenceMs / ONE_DAY);
  };

  function addDays(date: any, days: any) {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    if (result instanceof Date) {
      console.log(result, 'result');
      return result.toISOString().split("T")[0];
    }
    return undefined;
  }

  function rangeOnChange(e: any, index: any) {
    const val = args.value || [];
    args.onChange([...val.slice(0, index), e.target.value, ...val.slice(index + 1)]);
  }

  function dateOnChange(e: any, index: any) {
    const val = args.value || [];
    args.onChange([...val.slice(0, index), daysBetween(date,e.target.value) , ...val.slice(index + 1)]);
  }

  switch (type) {
    case 'dispatcher':
      return (
        <Select
          isMulti
          placeholder="Dispatcher"
          options={dispatcherOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'state':
      return (
        <Select
          isMulti
          placeholder="State"
          options={stateListAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'short-haul':
      return (
        <Select
          isMulti
          placeholder="Yes / No"
          options={shortHaulAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'assigned':
      return (
        <Select
          isMulti
          placeholder="Yes / No"
          options={assignedAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'move-type':
      return (
        <Select
          isMulti
          placeholder="Move Types"
          options={filterOptions?.moveType || []}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'haul-mode':
      return (
        <Select
          isMulti
          placeholder="Haul Modes"
          options={haulModeAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    case 'zone':
      return (
        <Select
          isMulti
          placeholder="Zone"
          options={zoneListAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
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
            onChange={(e: any) => rangeOnChange(e, 0)}
          />
          &nbsp;
          <InputField
            {...args}
            value={args.value ? args.value[1] : ''}
            type="date"
            placeholder="to"
            onChange={(e: any) => rangeOnChange(e, 1)}
          />
        </div>
      );
    case 'range':
      return (
        <div style={{ display: 'flex' }}>
          <InputField
            {...args}
            value={args.value ? args.value[0] : ''}
            type="number"
            placeholder="from"
            onChange={(e: any) => rangeOnChange(e, 0)}
          />
          &nbsp;
          <InputField
            {...args}
            value={args.value ? args.value[1] : ''}
            type="number"
            placeholder="to"
            onChange={(e: any) => rangeOnChange(e, 1)}
          />
        </div>
      );
    case 'trip-status':
      return (
        <Select
          isMulti
          placeholder="Status"
          options={TripStatusAsOptions}
          styles={createInputStyles(100)}
          isClearable={false}
          {...args}
          value={args.value || []}
        />
      );
    default:
      return (
        <InputField
          {...args}
          onChange={(e: any) => {
            args.onChange(e.target.value);
          }}
        />
      );
  }
}

const COLUMNS = 5;
const FIELDS_PER_COLUMN = Math.ceil(FIELDS.length / COLUMNS);

export function FilterTabs() {
  const [isOpen, setOpen] = useState(false);
  const chunkedFields = [];
  for (let i = 0; i < FIELDS.length; i += FIELDS_PER_COLUMN) {
    chunkedFields.push(FIELDS.slice(i, i + FIELDS_PER_COLUMN));
  }
  const dispatch = useDispatch();
  const query = useSelector((state: RootState) => state.shipments.query);
  const common_state = useSelector((state: RootState) => state.common);
  const [searchTerm, setSearchTerm] = useState(query.searchTerm)
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  const changeQuery = (query: any) => dispatch(changeShipmentQuery(query));
  const clearFilters = (e: any) => {
    e.stopPropagation();
    dispatch(resetToDefaultShipmentQuery());
  };
  const filterLength = Object.keys(query.filters).filter((key: any) => query.filters[key] && query.filters[key].length)
    .length;
  return (
    <div>
      <div className={styles.inputWrapper}>
        <InputField
          placeholder="Search (Name Order Reg)"

          onChange={(e: any) => {
            if(!e.target.value || e.target.value.length >= 3){
              changeQuery({ searchTerm: e.target.value });
            }
            setSearchTerm(e.target.value)
          }}
          value={searchTerm}
        />
      </div>
      <div className={styles.container}>
        <div
          className={styles.header}

        >
        <span
           onClick={() => {
            setOpen((state) => !state);
          }}
          >
          <i className={`fas fa-caret-right ${styles.caret} ${isOpen ? styles.rotate : ''}`} />
          Filters{' '}
          </span>
          {filterLength > 0 && (
            <>
              ({filterLength})
              <a className={styles.link} onClick={clearFilters}>
                Clear
              </a>
            </>
          )}
          {filterLength > 0 && (
            <a className={styles.link} onClick={() => setShowSaveFilterModal(true)}>
                Save
              </a>
          )}
          {
            <a className={styles.link} onClick={() => setShowFiltersModal(true)}>
                Filters
              </a>
            }
        </div>
        <div className={`${styles.body} ${isOpen ? styles.open : ''}`}>
          {chunkedFields.map((fields, i) => (
            <div key={i} className={styles.column}>
              {fields.map((field, i) => (
                <div className={styles.filterRow} key={i}>
                  <label>{field.label}</label>
                  <div className={styles.filterContainer}>
                    {renderFilterComponentByType(field.type, {
                      value: query.filters[field.property],
                      onChange: (value: any) => {
                        changeQuery({
                          filters: { ...query.filters, [field.property]: value },
                        });
                      },
                      ...field,
                    },
                    common_state)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {showFiltersModal && <FilterModal modalIsOpen={showFiltersModal} closeModal={() => setShowFiltersModal(false)} />}

      {/**Conditionally render to reset state betweens saves */
        showSaveFilterModal && <SaveFilterModal modalIsOpen={showSaveFilterModal} closeModal={() => setShowSaveFilterModal(false)} />}
    </div>
  );
}
