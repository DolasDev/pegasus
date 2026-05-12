import React from 'react'

import styles from './Card.module.css'

interface CardProps {
  active?: boolean
  title?: React.ReactNode
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
  // Test hooks / data attributes are forwarded to the root element so the E2E
  // suite can target ported cards (ShipmentCard, TripCard, pending-trip rows).
  [dataAttr: `data-${string}`]: string | undefined
}

export const Card: React.FC<CardProps> = ({
  active,
  title,
  children,
  style,
  className,
  onClick,
  ...rest
}) => {
  const dataProps = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith('data-')),
  )
  return (
    <div
      className={`${styles.container} ${active ? styles.active : ''} ${className}`}
      onClick={onClick}
      style={style}
      {...dataProps}
    >
      <div className={styles.title}>{title}</div>
      <div className={styles.children}>{children}</div>
    </div>
  )
}
