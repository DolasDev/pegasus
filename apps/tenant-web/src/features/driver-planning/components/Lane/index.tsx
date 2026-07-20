import React from 'react'
import styles from './Lane.module.css'

interface LaneProps {
  children?: React.ReactNode
  className?: string
  title?: React.ReactNode
}

export const Lane: React.FC<LaneProps> = ({ children, className = '', title }) => (
  <div className={`${styles.container} ${className}`}>
    {/* Render the heading only when a title is supplied — an empty <h5> still
        occupies its `margin: 10px 0`, and callers that want to supply their own
        sticky header (Shipments) pass no title to avoid a phantom gap above it. */}
    {title ? <h5 className={styles.title}>{title}</h5> : null}
    {children}
  </div>
)
