import React from 'react';
import styles from './InputField.module.css';

export function InputField({ value, onChange, className = '', ...rest }) {
  return <input className={`${styles.inputField} ${className}`} value={value} onChange={onChange} {...rest} />;
}
