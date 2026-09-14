'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import { useOverlay } from './useOverlay.js';
import styles from './Overlay.module.css';

export interface PopoverProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  readonly className?: string;
}

/** A small anchored panel (a filter menu, an account menu) — no backdrop, closes on outside click or Escape. */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = 'start',
  className,
}: PopoverProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, panelRef);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className={styles['popoverWrap']}>
      {trigger}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
          className={cx(styles['popover'], align === 'end' && styles['align-end'], className)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
