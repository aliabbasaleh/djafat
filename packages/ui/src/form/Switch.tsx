'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Form.module.css';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id' | 'type'> {
  readonly label: string;
  readonly className?: string;
}

/** A real `<input type="checkbox">` under the hood (`role="switch"` on top) — full keyboard/AT support for free. */
export function Switch({ label, className, checked, disabled, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cx(styles['optionRow'], disabled && styles['disabled'], className)}
    >
      <span className={styles['switchWrap']}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className={styles['switchInput']}
          checked={checked}
          disabled={disabled}
          {...rest}
        />
        <span
          className={cx(styles['switchTrack'], checked && styles['checked'])}
          aria-hidden="true"
        >
          <span className={styles['switchThumb']} />
        </span>
      </span>
      {label}
    </label>
  );
}
