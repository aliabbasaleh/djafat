'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminOrderSummary } from '@djafat/sdk';
import { ORDER_STATUSES } from '@djafat/types';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Badge, cx } from '@djafat/ui';
import { Button, Select, Input } from '@/components/ui-client';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [restaurantId, setRestaurantId] = useState('');

  const load = useCallback(
    async (p: number, status: string, restaurant: string) => {
      setState('loading');
      try {
        const result = await api.admin.orders.list({
          ...(status ? { status } : {}),
          ...(restaurant ? { restaurantId: restaurant } : {}),
          page: p,
          limit: LIMIT,
        });
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
    void load(1, '', '');
  }, [load]);

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Commandes</Heading>
      </div>

      <form
        className={cx(styles['filterRow'])}
        onSubmit={(e) => {
          e.preventDefault();
          void load(1, statusFilter, restaurantId);
        }}
      >
        <Select
          label="Statut"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Tous</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          label="ID restaurant"
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
        />
        <Button type="submit">Filtrer</Button>
      </form>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des commandes">
          <Skeleton height={40} />
          <Skeleton height={200} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les commandes"
          action={
            <Button onClick={() => void load(page, statusFilter, restaurantId)}>Réessayer</Button>
          }
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState icon="🧾" title="Aucune commande trouvée" message="Essayez d’autres filtres." />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <DataTable
            keyFor={(o) => o.id}
            rows={items}
            columns={[
              { header: 'Code', render: (o) => o.code },
              { header: 'Statut', render: (o) => <Badge tone="info">{o.status}</Badge> },
              { header: 'Total', render: (o) => formatMoney(o.total) },
              { header: 'Créée le', render: (o) => formatDate(o.createdAt) },
            ]}
          />
          <Pagination
            page={page}
            limit={LIMIT}
            total={total}
            onPageChange={(p) => void load(p, statusFilter, restaurantId)}
          />
        </>
      )}
    </Stack>
  );
}
