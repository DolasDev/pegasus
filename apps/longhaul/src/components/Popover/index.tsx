import React from 'react';
import styles from './Popover.module.css';

interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const Popover = React.forwardRef<HTMLDivElement, PopoverProps>(({ children, ...rest }, ref) => (
  <div ref={ref} className={styles['popover-container']} {...rest}>
    {children}
  </div>
));
