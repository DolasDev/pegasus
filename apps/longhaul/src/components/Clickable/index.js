import React from "react";

import styles from "./Clickable.module.css";

export const Clickable = ({
  value,
  style,
  className,
  onClick
}) => (
  <div
    className={`${styles.clickable} ${className}`}
    onClick={onClick}
    style={style}
  >{value}</div>
);
