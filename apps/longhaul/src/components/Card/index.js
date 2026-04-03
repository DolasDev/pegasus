import React from "react";

import styles from "./Card.module.css";

export const Card = ({
  active,
  title,
  children,
  style,
  className,
  onClick
}) => (
  <div
    className={`${styles.container} ${
      active ? styles.active : ""
    } ${className}`}
    onClick={onClick}
    style={style}
  >
    <div className={styles.title}>{title}</div>
    <div className={styles.children}>{children}</div>
  </div>
);
