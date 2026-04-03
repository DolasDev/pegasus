import React from "react";

import styles from "./Tabs.module.css";

export const Tabs = ({ tabs = [], selectedTabIndex, onTabClick }) => (
  <div className={styles.container}>
    {tabs.map((tabName, i) => (
      <div
        key={tabName}
        className={`${styles.tab} ${
          i === selectedTabIndex ? styles.selected : ""
        }`}
        onClick={() => onTabClick(i)}
      >
        {tabName}
      </div>
    ))}
  </div>
);
