import React from 'react'

import { Card } from '../../../../components/Card'
import styles from './TripCard.module.css'
import { formatDate } from '../../../../utils/format-date'
import { Link } from 'react-router'
import { HoverToolTip } from '../../../ToolTips'

// function getShortHaul(mode) {
//   return mode === 'yes' ? `${'S/H'}` : '';
// }

// function getMoveType(moveType) {
//   let visible = ['A', 'M', 'HA', 'SS'];
//   return visible.includes(moveType) ? `${moveType}` : '';
// }

// function getHaulMode(haulMode, shortHaul) {
//   return shortHaul !== 'yes' && haulMode ? `${haulMode.toUpperCase()}` : '';
// }

function getDriverName(driverName: any): string {
  return driverName || 'Unassigned'
}

function getTripHeading(Origin: any, Destination: any): string {
  return Origin ? `- ${Origin} - ${Destination}` : ''
}

function getTripTitle(title: any): string {
  return title ? ` ${title}` : ''
}

export function TripCard({ trip }: { trip: any }) {
  const rows = [
    [
      [
        'Start Date: ',
        `${formatDate(trip.actual_first_day || trip.planned_first_day, {
          defaultVal: '',
        })}`,
      ],
      ['Origin: ', `${trip.originState?.geo_code}`],
      ['Weight: ', `${trip.total_actual_lbs || trip.total_estimated_lbs}`],
      ['Est Linehaul: ', `${trip.total_estimated_linehaul_usd || ''}`],
      ['Self Hauls:', `${trip.load_activity_count}`],
    ],
    [
      // Row 2
      [
        'End Date: ',
        `${formatDate(trip.actual_first_day || trip.planned_last_day, {
          defaultVal: '',
        })}`,
      ],
      ['Destination: ', `${trip.destinationState?.geo_code}`],
      ['Days: ', `${trip.total_days || ''}`],
      //['Miles: ', `${trip.total_miles || '?'}`],
      ['Planner:', `${trip.planner?.first_name || ''} ${trip.planner?.last_name || '??'}`],
      ['Dispatcher:', `${trip.dispatcher?.first_name || ''} ${trip.dispatcher?.last_name || '??'}`],
    ],
  ]

  const status = trip.status ? trip.status.status : 'pending'
  const isCanceled = trip?.internal_status === 'canceled' // TODO constants

  return (
    <Link to={`/trip/${trip.id}`} className={isCanceled ? styles.canceled : ''}>
      <Card
        key={trip.id}
        className={styles['trip-card']}
        title={
          <>
            <span>{`Trip 
        ${trip.id} | 
        ${getTripTitle(trip.trip_title)} | 
        ${getDriverName(trip?.driver?.driver_name)}
        ${isCanceled ? ' - CANCELED' : ''}
        `}</span>
            {trip.vip_count || trip.supervip_count ? ' | ' : ''}
            {[...Array(trip.vip_count).keys()].map((x, i) => (
              <HoverToolTip key={i} content="VIP Shipper" direction="right">
                <i style={{ color: 'purple' }} className="far fa-id-badge"></i>
              </HoverToolTip>
            ))}
            {[...Array(trip.supervip_count).keys()].map((x, i) => (
              <HoverToolTip key={i} content="Super-VIP Shipper" direction="right">
                <i style={{ color: 'green' }} className="far fa-id-badge"></i>
              </HoverToolTip>
            ))}
          </>
        }
      >
        <div className={styles['trip-card-children']}>
          <div className={`${styles['status']} ${styles['status']} ${styles[status]}`}>
            {status}
          </div>
        </div>
        <div className={styles.row}>
          <div>
            {rows.map((row, i) => (
              <div className={`${styles.row}`} key={i}>
                {row.map((vals, idx) => (
                  <div className={`${styles.row}`} key={idx}>
                    <dt className={`${styles['card-data']} ${styles.bold}`}> {vals[0]}</dt>{' '}
                    <dt>{vals[1]}</dt>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Link>
  )
}
