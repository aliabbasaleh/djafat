'use client';

import styles from './Form.module.css';

export interface FieldSuggestionProps {
  /** The suggestion (« Vouliez-vous dire abakar@gmail.com ? »); nothing shows when `null`. */
  readonly text: string | null;
  /** The one action (« Oui, corriger »). */
  readonly actionLabel: string;
  readonly onAction: () => void;
}

/**
 * A suggestion under a field, with one action (FEAT-024, SPEC-024-04). The
 * live region stays in the page, so the suggestion is announced when it
 * appears.
 */
export function FieldSuggestion({ text, actionLabel, onAction }: FieldSuggestionProps) {
  return (
    <div aria-live="polite">
      {text && (
        <p className={styles['suggestion']}>
          <span>{text}</span>
          <button type="button" className={styles['suggestionAction']} onClick={onAction}>
            {actionLabel}
          </button>
        </p>
      )}
    </div>
  );
}
