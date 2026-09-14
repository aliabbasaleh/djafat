'use client';

import { useId, type TextareaHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { Label } from '../typography/Typography.js';
import styles from './Form.module.css';

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'> {
  readonly label: string;
  readonly helpText?: string;
  readonly error?: string;
  readonly className?: string;
}

export function Textarea({ label, helpText, error, className, ...rest }: TextareaProps) {
  const id = useId();
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={styles['field']}>
      <Label htmlFor={id}>{label}</Label>
      <textarea
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
