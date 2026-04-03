import React from "react";
import styles from "./Lane.module.css";

export const Lane = ({ children, className = "", title }) => (
  <div className={`${styles.container} ${className}`}>
    <h5 className={styles.title}>{title}</h5>
    {children}
  </div>
);
