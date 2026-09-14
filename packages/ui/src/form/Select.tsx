'use client';

import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { visuallyHiddenStyle } from '../utils/visually-hidden-style.js';
import { Label } from '../typography/Typography.js';
import styles from './Form.module.css';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'> {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

/** A native `<select>` — deliberately not a custom listbox: full keyboard/screen-reader support for free. */
export function Select({ label, hideLabel = false, children, className, ...rest }: SelectProps) {
  const id = useId();
  return (
    <div className={styles['field']}>
      <Label htmlFor={id} style={hideLabel ? visuallyHiddenStyle : undefined}>
        {label}
      </Label>
      <select id={id} className={cx(styles['control'], className)} {...rest}>
        {children}
      </select>
    </div>
  );
}
