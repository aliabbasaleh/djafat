'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/cx.js';
import { useOverlay } from './useOverlay.js';
import styles from './Overlay.module.css';

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly side?: 'left' | 'right';
  readonly className?: string;
}

/** A slide-in panel — the mobile menu, a filter sheet. Same focus-trap/Escape behaviour as `Modal`. */
export function Drawer({ open, onClose, title, children, side = 'right', className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useOverlay(open, onClose, panelRef);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={cx(
        styles['backdrop'],
        styles['drawerBackdrop'],
        side === 'left' && styles['left'],
      )}
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
        className={cx(styles['drawer'], className)}
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
