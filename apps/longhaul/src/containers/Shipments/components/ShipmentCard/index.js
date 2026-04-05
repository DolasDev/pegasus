import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { Card } from '../../../../components/Card';
import { CircularButton } from '../../../../components/Button';
import { selectShipment as selectShipmentAction } from '../../../../redux/shipments';
import { addShipmentToTrip as addShipmentToTripAction } from '../../../../redux/pending-trips';
import styles from './ShipmentCard.module.css';
import { formatDate, formatDateShort } from '../../../../utils/format-date';
import { sHaulMapping, haulModeMapping } from '../../../../utils/haul-mode-mapping';
import { HoverToolTip } from '../../../ToolTips';
import { startCase } from 'src/utils/string'

function getShortHaul(mode) {
  return mode === 'yes' ? `${'S/H'}` : '';
}

function getMoveType(moveType) {
  let visible = ['A', 'M', 'HA', 'SS'];
  return visible.includes(moveType) ? `${moveType}` : '';
}

function getHaulMode(haulMode, shortHaul) {
  return shortHaul !== 'yes' && haulMode ? `${haulMode.toUpperCase()}` : '';
}

function getDriverName(driverName) {
  return driverName ? getNameShort(driverName.split('#')[0]) : ' ';
}

function getTrip(value) {
  return value ?
    `${value} - `
    : '';
}

function getAccount(value) {
  return value ?
    value.split(' ')[0] 
    : '';
}

function getNameShort(value){
  const shipperNameParts = value.split(', ')
  const shipperShort = value ? getTitleCaseWord(shipperNameParts[0]) + ', ' +  (shipperNameParts.length > 1 ? shipperNameParts[1][0]: '')  : ''
  return(shipperShort)
}

function getTitleCaseWord(value){
  const titeCaseWord = startCase(value.toLowerCase())
  return(titeCaseWord)
}

function getPackDateStart(shipment){
  const packDate = formatDateShort(shipment.pack_date2, { defaultVal: '' })
  return( shipment.rule19_id ? (
    <>
      {packDate} &nbsp;
      <span 
        style = {{ color: 'green' }}>
          <HoverToolTip content="APU Comfirmed" direction="bottom">
            <i className="fas fa-truck-loading"  margin="5px"></i>
          </HoverToolTip>
      </span> 
      </>
  ) : (shipment.packing_coverage !== null && shipment.packing_coverage?.is_covered !== null)  ? (
      <>
      {packDate} &nbsp;
      {(shipment.packing_coverage?.is_covered
      ?<span 
        style = {{ color: 'orange' }}>
          <HoverToolTip content="OA Confirmed" direction="bottom">
            <i className="fas fa-shield-alt"  margin="5px"></i>
          </HoverToolTip>
      </span> 
      :<span 
      style = {{ color: 'brown' }}>
        <HoverToolTip content="OA Cannot Cover" direction="bottom">
          <i className="fas fa-shield-alt"  margin="5px"></i>
        </HoverToolTip>
    </span> 
      )}
      </>
    ) : 
    (<>{packDate} &nbsp;</>)
  )
}

function getPackDateEnd(shipment){
  const packDate = formatDateShort(shipment.plan_pack, { defaultVal: '' })
  return( shipment.pack_date2 !== shipment.plan_pack ? (
      <>
      {packDate}
      </>
    ) : 
    (<></>)
  )
}

function getLoadDateStart(shipment){
  const loadDate = formatDateShort(shipment.load_date2, { defaultVal: '' })
  return( shipment.rule19_id && shipment.driver_id ? (
      <>
      {loadDate} &nbsp;
      <span 
        style = {{ color: 'green' }}>
          <HoverToolTip content="Dock PU: Scheduled" direction="bottom">
          <i className="fas fa-warehouse" margin="5px"></i>
          </HoverToolTip>
          
      </span> 
      </>
    ) : shipment.rule19_id && !shipment.driver_id ? (
      <>
      {loadDate} &nbsp;
      <span 
        style = {{ color: 'orange' }}>
          <HoverToolTip content="Dock PU: Not Scheduled" direction="bottom">
          <i className="fas fa-warehouse" margin="5px"></i>
          </HoverToolTip>
          
      </span> 
      </>
    ) : 
    <>
    {loadDate} &nbsp;
    <span > {''/*
    <HoverToolTip content="Residence" direction="left">
        <i className="fas fa-house-user" margin="5px"></i>
    </HoverToolTip>*/}
    </span>  
    </>
  )
}

function getLoadDateEnd(shipment){
  const loadDate = formatDateShort(shipment.plan_load, { defaultVal: '' })
  return( shipment.load_date2 !== shipment.plan_load ? (
      <>
      {loadDate}
      </>
    ) : 
    (<></>)
  )
}

function getDeliveryDateStart(shipment){
  const deliveryDate = formatDate(shipment.del_date2, { defaultVal: '' })
  return( shipment.sit_date && shipment.storage_driver_id ? (
      <>
      {deliveryDate} &nbsp;
      <span 
        style = {{ color: 'green' }}>
          <HoverToolTip content="SIT Del: Scheduled" direction="bottom">
          <i className="fas fa-warehouse" margin="5px"></i>
          </HoverToolTip>
          
      </span> 
      </>
    ) : shipment.sit_date && !shipment.storage_driver_id ? (
      <>
      {deliveryDate} &nbsp;
      <span 
        style = {{ color: 'orange' }}>
          <HoverToolTip content="SIT Del: Not Scheduled" direction="bottom">
          <i className="fas fa-warehouse" margin="5px"></i>
          </HoverToolTip>
      </span> 
      </>
    ) : 
    <>
    {deliveryDate} &nbsp;
    <span > {''/*
    <HoverToolTip content="Residence" direction="left">
        <i className="fas fa-house-user" margin="5px"></i>
    </HoverToolTip>*/}
    </span>  
    </>
  )
}

function getFormattedWeight(weight) {
  if (typeof weight === 'number') {
    return (<b>{`${weight}`}</b>)
  }
  return 'N/A';
}


function statusCodeToText(status_id){
  switch(status_id){
    case 0:
      return('')
    case 1:
      return('Pending')
    case 2:
      return('Offered')
    case 3:
      return('Accepted')
    case 4:
      return('In Progress')
    case 5:
      return('Finalized')
    default:
      return('')
  }
}

export function ShipmentCard({ shipment, tripsForShipment }) {
  const dispatch = useDispatch();
  const selectShipment = useCallback((shipment) => dispatch(selectShipmentAction(shipment)), [dispatch]);

  const addShipmentToTrip = useCallback((shipment) => dispatch(addShipmentToTripAction(shipment)), [dispatch]);

  const selectedShipment = useSelector((state) => state.shipments.selectedShipment);

  const columns = [
    (<span><b>{`${shipment.shipper_state}`}</b>, <>{`${getTitleCaseWord(shipment.shipper_city)}`}</> </span>), 
    (<span><b>{`${shipment.consignee_state}`}</b>, <>{`${getTitleCaseWord(shipment.consignee_city)}`}</> </span>), 
    getFormattedWeight(shipment.total_est_wt),
    getPackDateStart(shipment),
    <b>{getLoadDateStart(shipment)}</b>,
    getDeliveryDateStart(shipment),
    `${getHaulMode(haulModeMapping[shipment.shaul])}`,
    getAccount(shipment.company || shipment.ba_name || ''),
    (<span><b>{`${getDriverName(shipment.driver_name)}`}</b></span>),
    // Line 2
    `${shipment.order_num} ${getMoveType(shipment.import_export)}`,
    `${shipment.avl_reg}`,
    getNameShort(shipment.shipper_name),
    getPackDateEnd(shipment),
    getLoadDateEnd(shipment),
    `${formatDate(shipment.plan_del, { defaultVal: '' })}`,
    `${getShortHaul(sHaulMapping[shipment.haul_mode])}`,
    `${getTrip(shipment.TripMaster_id)} ${statusCodeToText(shipment.TripStatus_id)}`,
    shipment.latest_activity_abbr ? `${shipment.latest_activity_abbr}: ${formatDate(shipment.latest_activity_date, { defaultVal: '' })}` : `${formatDate(shipment.latest_activity_date, { defaultVal: '' })}` ,
    
    //`$${shipment.line_haul}`,
  ];

  const getShipmentIndicator = () => {
    // TODO: not sure what this logic is.
    const indicator = 
      shipment.type_packing === 'Y' && shipment.supervip === 'Y' ? 'S-WGS' :
      shipment.type_packing === 'Y' && shipment.vip === 'Y' ? 'V-WGS' :
      shipment.type_packing === 'Y' ? 'WGS' :
      shipment.supervip === 'Y' ? 'S-VIP' : 
      shipment.vip === 'Y' ? 'VIP' :  
      null
    // Probably put a check to make sure it's in an enumeration and then return
    // empty string as a default value if not matched in the enum
    return indicator;
  }

  const columnSize = 9;
  const rows = [
    columns.slice(0, columnSize),
    [...columns.slice(columnSize), ...Array(columnSize - columns.slice(columnSize).length)],
  ];

  const isDisabled = tripsForShipment && tripsForShipment.length;
  
  return (
    <Card
      active={selectedShipment && selectedShipment.order_num === shipment.order_num}
      onClick={(e) => {
        e.stopPropagation();
        selectShipment(shipment);
      }}
      key={shipment.order_num}
      className={`
      ${styles.shipmentCard} 
      ${styles[getShipmentIndicator() ? getShipmentIndicator() : 'NONE']} 
      ${isDisabled ? styles.disabled : ''} 
      ${
        shipment.TripStatus_id === 1 ? '' : 
        shipment.TripStatus_id === 2 ? styles.offered : //yellow
        shipment.TripStatus_id === 3 ? styles.accepted : //orange
        shipment.TripStatus_id === 4 ? styles.inprogress : //green
        shipment.TripStatus_id === 5 ? styles.disabled : 
        ''}`}
      data-target="shipment-card"
    >
      <div className={`${styles.row}`}>
        <div className={styles.indicator}>
          {getShipmentIndicator()}
        </div>
        <div>
          {rows.map((row, i) => (
            <div className={`${styles.row}`} key={i}>
              {row.map((val, idx) => (
                <div
                  key={idx}
                  className={`
                  ${styles.row}
                  ${(i === 0 && (idx === 3 || idx === 4)  ) ? styles.icon : ''} 
                  ${
                    (i === 0 && idx !== 7) || (i === 1 && idx !== 1)
                      ? ''
                      : rows[0][7].includes('AVL')
                      ? styles.avl
                      : rows[0][7].includes('UNDECIDED')
                      ? styles.undecided
                      : rows[0][7].includes('SELF')
                      ? styles.self
                      : rows[0][7].includes('OTHER')
                      ? styles.other
                      : ''
                  } `}
                >
                  {val}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.tripButtonContainer}>
          <CircularButton
            disabled={isDisabled}
            className={styles.addTripButton}
            onClick={(e) => {
              e.stopPropagation();
              addShipmentToTrip(shipment);
            }}
          >
            +
          </CircularButton>
        </div>
      </div>
    </Card>
  );
}
