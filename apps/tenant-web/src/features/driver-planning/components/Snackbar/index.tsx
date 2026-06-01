import React, { useState, useEffect, useRef } from 'react'
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
  }, [open])

  // ref avoids re-firing the autohide timer when the parent passes a fresh inline `onClose` arrow each render
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open || !autoHideDuration) return
    const t = setTimeout(() => onCloseRef.current(), autoHideDuration)
    return () => clearTimeout(t)
  }, [open, autoHideDuration])

  return (
    (open || isOpen) && (
      <div
        data-target="snackbar"
        data-snackbar-type={type || undefined}
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
