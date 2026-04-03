import React from "react";
import { Link } from "react-router-dom";
import styles from "./NavItem.module.css";

export function NavItem({ label, route, Icon, selected }) {
  return (
    <Link
      className={`${styles.navItem} ${selected ? styles.selected : ""}`}
      to={route}
    >
      {Icon}
      {label}
    </Link>
  );
}
