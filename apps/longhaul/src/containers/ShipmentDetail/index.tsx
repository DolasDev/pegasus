import React, { useCallback, useState, useRef, useEffect } from 'react'
import styles from './ShipmentDetail.module.css'
import { useSelector } from 'react-redux'
import { selectShipment as selectShipmentAction } from '../../redux/shipments'
import { IconButton } from '../../components/Button'
import { useOutsideClick } from '../../utils/hooks/use-outside-click'
import { formatDate } from '../../utils/format-date'
import { Link } from 'react-router-dom'
import { Clickable } from '../../components/Clickable'
import { API } from '../../utils/api'
import { ShipmentCoverage } from './components/Coverage'
import { ShipmentWeight } from './components/Weight'
import { DispatchNote } from './components/DispatchNote'
import { useAppDispatch } from '../../redux/hooks'
import type { RootState } from '../../redux/store'

const createFromToDateString = (startDate: any, endDate?: any) =>
  `${formatDate(startDate)} - ${formatDate(endDate)}`

const createTripString = (shipment: any) =>
  `${shipment.shipper_city}, ${shipment.shipper_state} - ${shipment.consignee_city}, ${shipment.consignee_state}`

export function ShipmentDetail({
  onUpdateShadow,
  onUpdateNote,
}: {
  onUpdateShadow?: () => void
  onUpdateNote?: () => void
}) {
  const ifUpdateShadow = () => {
    if (onUpdateShadow) {
      onUpdateShadow()
    }
  }

  const fields = [
    {
      accessor: 'shipper_name',
      label: 'Shipper Name',
    },
    {
      accessor: (shipment: any) => (
        <Clickable
          value={`${shipment.order_num}`}
          onClick={() => API.jumpToOrder({ order_num: shipment.order_num })}
        ></Clickable>
      ),
      label: 'Order Number',
    },
    {
      accessor: 'avl_reg',
      label: 'Reg Number',
    },
    {
      accessor: 'move_desc',
      label: 'Move Description',
    },
    // {
    //     accessor: 'shaul',
    //     label: 'Haul Mode',
    // },
    // {
    //     accessor: 'haul_mode',
    //     label: 'Short Haul',
    // },

    {
      accessor: 'ba_name',
      label: 'Account Name',
    },
    {
      accessor: 'booker_name',
      label: 'Booker Name',
    },

    {
      accessor: 'haul_name',
      label: 'Hauler Name',
    },

    {
      accessor: 'coordinator',
      label: 'Coordinator',
    },

    {
      accessor: 'OpsLastName',
      label: 'Operations',
    },

    { accessor: '', label: '' },

    {
      accessor: (shipment: any) => (
        <Link to={`/trip/${shipment.TripMaster_id}`}>{shipment.TripMaster_id}</Link>
      ),
      label: 'Trip Id',
    },

    {
      accessor: createTripString,
      label: 'Trip Location',
    },

    {
      accessor: (shipment: any) => (
        <span>
          {`${shipment.oa_id} - ${shipment.oa_name}`}
          <ShipmentCoverage onUpdate={ifUpdateShadow} />
        </span>
      ),
      label: 'O/A',
    },

    {
      accessor: (shipment: any) => `${shipment.da_id} - ${shipment.da_name}`,
      label: 'D/A',
    },

    {
      accessor: 'stg_id',
      label: 'S/A',
    },

    { accessor: 'stgindicator', lable: '' },

    {
      accessor: (shipment: any) => formatDate(shipment.survey_date),
      label: 'Survey Date',
    },
    {
      accessor: 'total_est_wt',
      label: 'Est Weight',
    },
    {
      accessor: (shipment: any) => (
        <span>
          {`${weight || shipment.pegasus_shadow?.weight || ''}`}
          <ShipmentWeight onUpdate={onUpdateWeight} />
        </span>
      ),
      label: 'Actual Weight',
    },

    {
      accessor: 'mileage',
      label: 'Mileages',
    },

    {
      accessor: (shipment: any) => createFromToDateString(shipment.pack_date2, shipment.plan_pack),
      label: 'Pack Date Spread',
    },
    {
      accessor: (shipment: any) => formatDate(shipment.pack_actual),
      label: 'Actual Pack Date',
    },
    {
      accessor: (shipment: any) => createFromToDateString(shipment.load_date2, shipment.plan_load),
      label: 'Load Date Spread',
    },
    {
      accessor: (shipment: any) => formatDate(shipment.load_actual),
      label: 'Actual Load Date',
    },
    {
      accessor: (shipment: any) => formatDate(shipment.sit_date),
      label: 'SIT Date',
    },
    {
      accessor: (shipment: any) => createFromToDateString(shipment.del_date2, shipment.plan_del),
      label: 'Del Date Spread',
    },
    {
      accessor: (shipment: any) => formatDate(shipment.del_actual),
      label: 'Actual Del Date',
    },

    {
      accessor: 'driver_name',
      label: 'Driver Name',
    },

    { accessor: '', label: '' },

    {
      accessor: () => '',
      label: 'Origin Address',
    },
    {
      accessor: (shipment: any) => `${shipment.origin_address1}, ${shipment.origin_address2}`,
      label: '',
    },
    {
      accessor: (shipment: any) =>
        `${shipment.shipper_city}, ${shipment.shipper_state}, ${shipment.origin_zip}`,

      label: '',
    },
    {
      accessor: () => '',
      label: 'Destination Address',
    },
    {
      accessor: (shipment: any) =>
        `${shipment.destination_address1}, ${shipment.destination_address2}`,
      label: '',
    },
    {
      accessor: (shipment: any) =>
        `${shipment.consignee_city} ${shipment.consignee_state}, ${shipment.destination_zip}`,

      label: '',
    },

    {
      accessor: (shipment: any) => `${shipment.extrapu}  ${shipment.extradel}`,
      label: '',
    },

    {
      accessor: 'disp_instructions',
      label: 'Special Instructions',
    },

    {
      accessor: 'registration_notes',
      label: 'Customer Account Notes',
    },

    {
      accessor: 'oshuttle',
      label: '',
    },
    {
      accessor: 'dshuttle',
      label: '',
    },

    { accessor: '', label: '' },

    {
      accessor: (shipment: any) => (
        <>
          <span>
            <DispatchNote onUpdate={onUpdateDispatchInstructions} />
          </span>
          <div>
            <span>
              {(dispatchInstructions || `${shipment.pegasus_shadow.lng_dis_comments}`)
                .toLowerCase()
                .indexOf('@' + user.first_name.toLowerCase()) !== -1 ? (
                <b style={{ color: 'green' }}>{'@' + user.first_name.toLowerCase()}</b>
              ) : null}
            </span>
            <span>
              {(dispatchInstructions || `${shipment.pegasus_shadow.lng_dis_comments}`)
                .toLowerCase()
                .indexOf('@all') !== -1 ? (
                <b style={{ color: 'green' }}>{'@all '}</b>
              ) : null}
            </span>
            <span>{dispatchInstructions || `${shipment.pegasus_shadow.lng_dis_comments}`}</span>
          </div>
        </>
      ),
      label: 'Long Distance Instructions',
    },
    { accessor: '', label: '' },

    {
      accessor: 'survey_remarks',
      label: 'Survey Remarks',
    },

    { accessor: '', label: '' },

    {
      accessor: (shipment: any) => createFromToDateString(shipment.ship_load_date),
      label: 'APU In',
    },

    {
      accessor: (shipment: any) => createFromToDateString(shipment.rule19_out_date),
      label: 'APU Out',
    },

    {
      accessor: 'pickup_num',
      label: 'APD Number',
    },

    {
      accessor: 'rule19_id',
      label: 'APU Agent',
    },

    {
      accessor: 'load_driver',
      label: 'APD Driver',
    },
  ]

  const user = useSelector((state: RootState) => (state as any).user.user)

  const dispatch = useAppDispatch()

  const selectShipment = useCallback(
    (shipment: any) => dispatch(selectShipmentAction(shipment) as any),
    [dispatch],
  )

  const selectedShipment = useSelector((state: RootState) => state.shipments.selectedShipment)

  const show = !!selectedShipment
  const wrapperRef = useRef(null)
  useOutsideClick([wrapperRef], () => {
    if (show) {
      selectShipment(null)
    }
  })

  const [weight, updateWeight] = useState<any>(null)
  const [dispatchInstructions, updateDispatchInstructions] = useState<any>(null)

  const onUpdateWeight = (weight: any) => {
    updateWeight(weight)
    ifUpdateShadow()
  }

  const onUpdateDispatchInstructions = (dispatchInstructions: any) => {
    updateDispatchInstructions(dispatchInstructions)
    ifUpdateShadow()
  }

  useEffect(() => {
    updateWeight(null)
    updateDispatchInstructions(null)
  }, [selectedShipment])

  return (
    <div ref={wrapperRef} className={`${styles['detail-container']} ${show ? styles.show : ''}`}>
      <IconButton
        className={styles.closeIcon}
        onClick={() => selectShipment(null)}
        Icon={<i className="fa fa-close"></i>}
      />
      {selectedShipment &&
        fields.map(({ label, accessor }: any, index: number) => (
          <div key={index} className={styles['shipment-detail']}>
            <b>{label}</b>
            {typeof accessor === 'string'
              ? (selectedShipment as any)[accessor]
              : accessor(selectedShipment)}
          </div>
        ))}
    </div>
  )
}
