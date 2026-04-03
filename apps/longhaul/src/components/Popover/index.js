import React from 'react';
import styles from './Popover.module.css';

export const Popover = React.forwardRef(({ children, ...rest }, ref) => (
  <div ref={ref} className={styles['popover-container']} {...rest}>
    {children}
  </div>
));
