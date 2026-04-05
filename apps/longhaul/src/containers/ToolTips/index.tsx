import React, { useState } from "react";
import "./ToolTips.module.css";
import styles from "./ToolTips.module.css";

interface HoverToolTipProps {
  children?: React.ReactNode;
  content?: React.ReactNode;
  direction?: string;
  delay?: number;
}

export const HoverToolTip: React.FC<HoverToolTipProps> = (props) => {
  let timeout: ReturnType<typeof setTimeout>;
  const [active, setActive] = useState(false);

  const showTip = () => {
    timeout = setTimeout(() => {
      setActive(true);
    }, props.delay || 400);
  };

  const hideTip = () => {
    clearInterval(timeout as any);
    setActive(false);
  };

  return (
    <div
      className={styles['Tooltip-Wrapper']}
      // When to show the tooltip
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
    >
      {/* Wrapping */}
      {props.children}
      {active && (
        <div className={`${styles['Tooltip-Tip']} ${styles[props.direction || "top"]}`}>
          {/* Content */}
          {props.content}
        </div>
      )}
    </div>
  );
};
