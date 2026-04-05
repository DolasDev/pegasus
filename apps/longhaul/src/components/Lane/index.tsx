import React from "react";
import styles from "./Lane.module.css";

interface LaneProps {
  children?: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
}

export const Lane: React.FC<LaneProps> = ({ children, className = "", title }) => (
  <div className={`${styles.container} ${className}`}>
    <h5 className={styles.title}>{title}</h5>
    {children}
  </div>
);
