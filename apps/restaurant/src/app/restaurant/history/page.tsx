'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type RestaurantOrderSummary } from '@djafat/sdk';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Badge, cx } from '@djafat/ui';
import { Button, Select } from '@/components/ui-client';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney, formatDateTime } from '@/lib/format';
import { statusLabel, statusTone } from '@/lib/order-status';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;
const HISTORY_STATUSES = ['delivered', 'cancelled', 'rejected', 'expired'] as const;

/** Terminal orders only (Bloc 10, docs/33 §history) — the live board (`/restaurant`) already covers everything still in flight. One status at a time: `listOrdersForRestaurant` is single-status in history mode (docs/33 §order-board). */
export default function OrderHistoryPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<RestaurantOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof HISTORY_STATUSES)[number]>('delivered');

  const load = useCallback(
    async (p: number, s: (typeof HISTORY_STATUSES)[number]) => {
      setState('loading');
      try {
        const result = await api.restaurant.orders.list({ status: s, page: p, limit: LIMIT });
        setItems([...result.items]);
        setTotal(result.total);
        setPage(result.page);
        setState('ready');
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          clearSession();
          router.replace('/login');
          return;
        }
        setState('error');
      }
    },
    [router],
  );

  useEffect(() => {
    void load(1, status);
    // intentionally run once on mount only — `status`/`load` changes are
    // driven by the filter form's own submit handler, not by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design (see comment above)
  }, []);

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Historique</Heading>
      </div>

      <form
        className={cx(styles['filterRow'])}
        onSubmit={(e) => {
          e.preventDefault();
          void load(1, status);
        }}
      >
        <Select
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof HISTORY_STATUSES)[number])}
        >
          {HISTORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        <Button type="submit">Filtrer</Button>
      </form>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement de l’historique">
          <Skeleton height={40} />
          <Skeleton height={200} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger l’historique"
          action={<Button onClick={() => void load(page, status)}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState icon="🧾" title="Aucune commande" message="Rien pour ce statut." />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <DataTable
            keyFor={(o) => o.id}
            rows={items}
            columns={[
              { header: 'Code', render: (o) => o.code },
              {
                header: 'Statut',
                render: (o) => <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>,
              },
              { header: 'Total', render: (o) => formatMoney(o.total) },
              { header: 'Créée le', render: (o) => formatDateTime(o.createdAt) },
            ]}
          />
          <Pagination
            page={page}
            limit={LIMIT}
            total={total}
            onPageChange={(p) => void load(p, status)}
          />
        </>
      )}
    </Stack>
  );
}
