'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { visuallyHiddenStyle } from '../utils/visually-hidden-style.js';
import { Label } from '../typography/Typography.js';
import styles from './Form.module.css';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly helpText?: string;
  readonly error?: string;
  readonly className?: string;
}

/** A labelled text input. `label` is mandatory — a placeholder is never an acceptable substitute for one. */
export function Input({
  label,
  hideLabel = false,
  helpText,
  error,
  className,
  ...rest
}: InputProps) {
  const id = useId();
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={styles['field']}>
      <Label htmlFor={id} style={hideLabel ? visuallyHiddenStyle : undefined}>
        {label}
      </Label>
      <input
        id={id}
        className={cx(styles['control'], error && styles['invalid'], className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(helpId, errorId) || undefined}
        {...rest}
      />
      {helpText && !error && (
        <p id={helpId} className={styles['helpText']}>
          {helpText}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles['errorText']} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
