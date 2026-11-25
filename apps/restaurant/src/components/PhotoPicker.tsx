'use client';

import { useId, useRef } from 'react';
import { cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { photoForUpload } from '@/lib/photo';
import styles from './PhotoPicker.module.css';

/** SPEC-022-04 R2: what the API accepts. */
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * FEAT-022 (SPEC-022-04 R2, SPEC-022-05 R1): one photo from the computer or
 * the phone — JPEG, PNG or WebP, 5 MB at most (the API checks it again); a
 * larger photo is reduced first (FEAT-022-Q09).
 * A public photo shows its preview; a private paper only says it was sent.
 */
export function PhotoPicker({
  label,
  actionLabel,
  preview,
  sent,
  wide = false,
  busy = false,
  disabled = false,
  error,
  hint = 'JPEG, PNG ou WebP, 5 Mo au plus.',
  onPick,
  extra,
}: {
  readonly label: string;
  /** « Choisir le logo », « Remplacer la photo »… */
  readonly actionLabel: string;
  readonly preview?: { readonly url: string; readonly alt: string } | null;
  /** A private paper: sent or not, never shown here. */
  readonly sent?: boolean;
  readonly wide?: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly error?: string | null;
  readonly hint?: string;
  /** The photo to send, already reduced when it was large (FEAT-022-Q09). */
  readonly onPick: (photo: Blob) => void;
  readonly extra?: React.ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div className={cx(styles['picker'])}>
      <span className={cx(styles['label'])} id={`${id}-label`}>
        {label}
      </span>
      {preview !== undefined &&
        (preview ? (
          <img
            src={preview.url}
            alt={preview.alt}
            className={cx(styles['preview'], wide && styles['wide'])}
          />
        ) : (
          <div className={cx(styles['empty'], wide && styles['wide'])} aria-hidden="true">
            Aucune image
          </div>
        ))}
      {sent !== undefined && <span>{sent ? '✅ Photo envoyée' : '⬜ Pas encore de photo'}</span>}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className={cx(styles['input'])}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void photoForUpload(file).then(onPick);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={disabled || busy}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onClick={() => input.current?.click()}
      >
        {actionLabel}
      </Button>
      <span className={cx(styles['hint'])} id={`${id}-hint`}>
        {hint}
      </span>
      {error && (
        <span className={cx(styles['error'])} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
      {extra}
    </div>
  );
}
