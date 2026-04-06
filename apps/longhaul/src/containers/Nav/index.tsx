import React from 'react'
import { useLocation } from 'react-router'
import styles from './Nav.module.css'
import { NavItem } from './NavItem'
import { useSelector } from 'react-redux'
import { toggleNav as toggleNavAction } from '../../redux/nav'
import type { RootState } from '../../redux/store'

const options = [
  {
    label: 'Planning',
    route: '/',
    Icon: <i className="fas fa-clipboard-list"></i>,
  },
  {
    label: 'Trips',
    route: '/trips',
    Icon: <i className="fas fa-calendar-alt"></i>,
  },
]

export function Nav() {
  const location = useLocation()
  const visible = useSelector((state: RootState) => state.nav.visible)
  return (
    <nav>
      <nav role="navigation" className={`${styles.navbar} ${visible ? styles.show : styles.hide}`}>
        <div>
          {options.map((option, i) => (
            <NavItem key={i} {...option} selected={option.route === location.pathname} />
          ))}
        </div>
      </nav>
    </nav>
  )
}
