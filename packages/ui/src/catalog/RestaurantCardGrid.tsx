import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import styles from './Catalog.module.css';

/** Responsive wrapper for a list of `RestaurantCard`s — 1 column on a phone, up to 4 on a wide desktop. */
export function RestaurantCardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <ul className={cx(styles['restaurantGrid'], className)}>{children}</ul>;
}

export function RestaurantCardGridItem({ children }: { children: ReactNode }) {
  return <li className={styles['restaurantGridItem']}>{children}</li>;
}
