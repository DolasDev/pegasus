import React from "react";

import styles from "./Clickable.module.css";

interface ClickableProps {
  value?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export const Clickable: React.FC<ClickableProps> = ({
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
