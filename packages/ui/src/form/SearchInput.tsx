'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { VisuallyHidden } from '../foundations/VisuallyHidden.js';
import styles from './Form.module.css';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id' | 'type'> {
  readonly label: string;
  readonly className?: string;
}

/** The search field used across the catalogue — icon, labelled input, no visible label box (icon + placeholder carry it). */
export function SearchInput({ label, className, ...rest }: SearchInputProps) {
  const id = useId();
  return (
    <div className={cx(styles['searchRow'], className)}>
      <VisuallyHidden>
        <label htmlFor={id}>{label}</label>
      </VisuallyHidden>
      <span className={styles['searchIcon']} aria-hidden="true">
        🔎
      </span>
      <input id={id} type="search" className={styles['searchField']} {...rest} />
    </div>
  );
}
