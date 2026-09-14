'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Navigation.module.css';

export interface TabItem {
  readonly id: string;
  readonly label: string;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly 'aria-label': string;
  readonly className?: string;
}

/** A `tablist` with the full WAI-ARIA APG keyboard pattern: ←/→ moves AND activates, Home/End jump to the ends. */
export function Tabs({ items, activeId, onChange, className, ...rest }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function focusAndSelect(index: number) {
    const clamped = (index + items.length) % items.length;
    const id = items[clamped]?.id;
    if (id === undefined) return;
    onChange(id);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[clamped];
    btn?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = items.findIndex((i) => i.id === activeId);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAndSelect(currentIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAndSelect(currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAndSelect(items.length - 1);
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cx(styles['tabList'], className)}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`tabpanel-${item.id}`}
            tabIndex={active ? 0 : -1}
            className={cx(styles['tab'], active && styles['active'])}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
