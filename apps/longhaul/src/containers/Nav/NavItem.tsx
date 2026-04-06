import React from 'react'
import { Link } from 'react-router'
import styles from './NavItem.module.css'

interface NavItemProps {
  label: string
  route: string
  Icon: React.ReactNode
  selected: boolean
}

export function NavItem({ label, route, Icon, selected }: NavItemProps) {
  return (
    <Link className={`${styles.navItem} ${selected ? styles.selected : ''}`} to={route}>
      {Icon}
      {label}
    </Link>
  )
}
