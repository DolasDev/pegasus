import React from 'react';
import styles from './InputField.module.css';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  limit?: number;
  [key: string]: any;
}

export function InputField({ value, onChange, className = '', ...rest }: InputFieldProps) {
  return <input className={`${styles.inputField} ${className}`} value={value} onChange={onChange} {...rest} />;
}
