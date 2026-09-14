import Link from 'next/link';
import { cx } from '../utils/cx.js';
import styles from './Catalog.module.css';

export interface CategoryChipProps {
  readonly label: string;
  readonly href: string;
  readonly selected?: boolean;
  readonly className?: string;
}

/** A single category pill — used for browse-by-category and as an active filter indicator. */
export function CategoryChip({ label, href, selected = false, className }: CategoryChipProps) {
  return (
    <Link
      href={href}
      className={cx(styles['chip'], selected && styles['selected'], className)}
      aria-current={selected ? 'true' : undefined}
    >
      {label}
    </Link>
  );
}
