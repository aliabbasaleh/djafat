'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui-client';
import styles from './account.module.css';

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'id'> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly autoComplete: 'current-password' | 'new-password';
}

/**
 * A password input with « Afficher / Masquer » (FEAT-020-VIS01, VIS02). The
 * toggle is a real button with its state announced (`aria-pressed`).
 */
export function PasswordField({ label, error, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles['passwordField']}>
      <Input
        label={label}
        type={visible ? 'text' : 'password'}
        {...(error ? { error } : {})}
        {...rest}
      />
      <button
        type="button"
        className={styles['reveal']}
        aria-pressed={visible}
        aria-label={visible ? `Masquer : ${label}` : `Afficher : ${label}`}
        onClick={() => setVisible((v) => !v)}
      >
        <span aria-hidden="true">👁</span> {visible ? 'Masquer' : 'Afficher'}
      </button>
    </div>
  );
}
