'use client';

import { cx } from '../utils/cx.js';
import styles from './Feedback.module.css';

export interface GreetingProps {
  /** The signed-in person's first name, when known — omit for a generic greeting. */
  readonly name?: string | null;
  /** A short, role-specific line under the hello (e.g. what they can do here today). */
  readonly message: string;
  readonly className?: string;
}

function salutation(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Bonne nuit';
  if (hour < 18) return 'Bonjour';
  return 'Bonsoir';
}

/**
 * A warm, personal hello at the top of a signed-in landing screen — never
 * rendered server-side (the session only exists in the browser), so every
 * caller is already a Client Component.
 */
export function Greeting({ name, message, className }: GreetingProps) {
  return (
    <div className={cx(styles['greeting'], className)}>
      <p className={styles['greetingHello']}>
        {salutation()}
        {name ? `, ${name}` : ''} <span aria-hidden="true">👋</span>
      </p>
      <p className={styles['greetingMessage']}>{message}</p>
    </div>
  );
}
