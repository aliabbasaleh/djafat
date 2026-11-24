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
  /**
   * A fixed text in front of the box, not typed (FEAT-024: « +235 » before a
   * phone number). Announced with the field, after « indicatif ».
   */
  readonly leadingText?: string;
}

/** A labelled text input. `label` is mandatory — a placeholder is never an acceptable substitute for one. */
export function Input({
  label,
  hideLabel = false,
  helpText,
  error,
  className,
  leadingText,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const leadingId = leadingText ? `${id}-leading` : undefined;
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = (
    <input
      id={id}
      className={cx(styles['control'], error && styles['invalid'], className)}
      aria-invalid={error ? true : undefined}
      // FEAT-024 (SPEC-024-02 « UI »): « +235 » is part of the field's name.
      aria-labelledby={leadingId ? `${labelId} ${leadingId}` : undefined}
      aria-describedby={cx(describedBy, helpId, errorId) || undefined}
      {...rest}
    />
  );

  return (
    <div className={styles['field']}>
      <Label id={labelId} htmlFor={id} style={hideLabel ? visuallyHiddenStyle : undefined}>
        {label}
      </Label>
      {leadingText ? (
        <div className={styles['affixed']}>
          <span id={leadingId} className={styles['leading']}>
            <span style={visuallyHiddenStyle}>{`, indicatif ${leadingText}`}</span>
            <span aria-hidden="true">{leadingText}</span>
          </span>
          {control}
        </div>
      ) : (
        control
      )}
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
