import React from "react";

import styles from "./Card.module.css";

interface CardProps {
  active?: boolean;
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  'data-target'?: string;
}

export const Card: React.FC<CardProps> = ({
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
