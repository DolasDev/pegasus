import React, { useState, useEffect } from 'react'
import styles from './Snackbar.module.css'

export const Snackbar: React.FC<any> = ({
  autoHideDuration = 3000,
  open = false,
  message = '',
  onClose = () => {},
  className = '',
  type,
}) => {
  const [isOpen, setIsOpen] = useState(open)

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (open !== isOpen) {
        setIsOpen(open)
      }
    }, 300)
    return () => clearTimeout(timeout)
  })

  useEffect(() => {
    if (open && autoHideDuration) {
      setTimeout(() => {
        onClose()
      }, autoHideDuration)
    }
  })

  return (
    (open || isOpen) && (
      <div
        className={`
          ${styles.root} 
          ${isOpen && open ? styles.transition : ''} 
          ${styles[type]} 
          ${className}`}
      >
        {message}
      </div>
    )
  )
}
