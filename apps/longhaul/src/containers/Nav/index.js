import React, { useCallback, useState, useRef } from 'react';
import { withRouter } from 'react-router';
import styles from './Nav.module.css';
import { NavItem } from './NavItem';
import { useDispatch, useSelector } from 'react-redux';
import { toggleNav as toggleNavAction } from '../../redux/nav';

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
];

function NavPriv({ location }) {
  const visible = useSelector((state) => state.nav.visible);
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
  );
}

export const Nav = withRouter(NavPriv);
