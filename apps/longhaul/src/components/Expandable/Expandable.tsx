import React, { type ReactNode, useState } from 'react'
import styles from './Expandable.module.css'

interface ExpandableProps {
  title: ReactNode
  children: ReactNode
}

export const Expandable: React.FC<ExpandableProps> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false)
  const toggleExpansion = () => {
    setIsOpen((state) => !state)
  }
  return (
    <div>
      <div className={styles.titleContainer} onClick={toggleExpansion}>
        <i className={`fas fa-caret-right ${styles.caret} ${isOpen ? styles.rotate : ''}`} />
        <h3>{title}</h3>
      </div>
      <div>{isOpen ? children : null}</div>
    </div>
  )
}
