'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Feedback.module.css';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

interface ToastEntry {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, options?: { tone?: ToastTone; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Transient, auto-dismissing notifications — distinct from `Alert` (persistent,
 * inline). Not consumed by any Bloc 3 page yet (no async mutation flow exists
 * before Bloc 4's cart) — built now as a ready, tested primitive for when one
 * does (docs/21 §4).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const nextId = useRef(0);

  const show = useCallback(
    (message: string, options?: { tone?: ToastTone; durationMs?: number }) => {
      const id = ++nextId.current;
      const tone = options?.tone ?? 'info';
      setToasts((prev) => [...prev, { id, message, tone }]);
      const durationMs = options?.durationMs ?? 4000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    },
    [],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles['toastViewport']} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={styles['toast']}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used within a <ToastProvider>.');
  return ctx;
}
