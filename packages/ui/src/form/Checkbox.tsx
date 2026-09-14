'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Form.module.css';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id' | 'type'> {
  readonly label: string;
  readonly className?: string;
}

export function Checkbox({ label, className, disabled, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx(styles['optionRow'], disabled && styles['disabled'], className)}
    >
      <input
        id={id}
        type="checkbox"
        className={styles['nativeInput']}
        disabled={disabled}
        {...rest}
      />
      {label}
    </label>
  );
}
