import React from 'react'

import style from './Button.module.css'

type ButtonProps = any

export const Button: React.FC<ButtonProps> = React.forwardRef<ButtonProps>(
  (
    { children, onClick, className = '', color = '', inverted = false, ...rest }: ButtonProps,
    ref,
  ) => (
    <button
      ref={ref}
      className={`${style.button} ${inverted ? style.inverted : ''} ${className} ${style[color] || ''}`}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  ),
)

export const CircularButton: React.FC<any> = React.forwardRef<any>(
  ({ className, ...args }: any, ref) => (
    <Button ref={ref} className={`${style.circularButton} ${className}`} {...args} />
  ),
)

export const IconButton: React.FC<any> = ({ className, Icon, ...args }: any) => (
  <button className={`${style.iconButton} ${className}`} {...args}>
    {Icon}
  </button>
)
