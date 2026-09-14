'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/cx.js';
import { useOverlay } from './useOverlay.js';
import styles from './Overlay.module.css';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A centred, focus-trapping dialog. Not used by any Bloc 3 page yet (no
 * flow in this bloc needs one) — built now as a ready, tested primitive
 * (docs/21 §4), the same way Modal/Drawer/Popover were requested for future
 * blocs to reach for without rebuilding overlay accessibility from scratch.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useOverlay(open, onClose, panelRef);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={cx(styles['backdrop'], styles['modalBackdrop'])}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(styles['modal'], className)}
      >
        <div className={styles['header']}>
          <h2 id={titleId} className={styles['title']}>
            {title}
          </h2>
          <button
            type="button"
            className={styles['closeButton']}
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
