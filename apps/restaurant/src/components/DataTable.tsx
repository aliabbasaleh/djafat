'use client';

import type { ReactNode } from 'react';
import { Text, cx } from '@djafat/ui';
import { Button } from './ui-client';
import styles from './DataTable.module.css';

export interface Column<T> {
  readonly header: string;
  readonly render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly keyFor: (row: T) => string;
}

/**
 * Copied from `apps/admin/src/components/DataTable.tsx` (Bloc 9) — same
 * reasoning: a plain semantic `<table>`, no `@djafat/ui` primitive for this
 * exists, and one table used a couple of times doesn't justify inventing a
 * new design-system component.
 */
export function DataTable<T>({ columns, rows, keyFor }: DataTableProps<T>) {
  return (
    <div className={cx(styles['scroll'])}>
      <table className={cx(styles['table'])}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyFor(row)}>
              {columns.map((c) => (
                <td key={c.header}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  readonly busy?: boolean;
}

export function Pagination({ page, limit, total, onPageChange, busy }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className={cx(styles['pagination'])}>
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1 || busy}
        onClick={() => onPageChange(page - 1)}
      >
        Précédent
      </Button>
      <Text size="small" tone="secondary">
        Page {page} / {totalPages} — {total} résultat{total > 1 ? 's' : ''}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages || busy}
        onClick={() => onPageChange(page + 1)}
      >
        Suivant
      </Button>
    </div>
  );
}
