import React from 'react'
import styles from './PopoverShell.module.css'

interface PopoverShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

export const PopoverShell = React.forwardRef<HTMLDivElement, PopoverShellProps>(
  ({ children, ...rest }, ref) => (
    <div ref={ref} className={styles['popover-container']} {...rest}>
      {children}
    </div>
  ),
)
