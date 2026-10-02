'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminRestaurantSummary, type OwnerBalance } from '@djafat/sdk';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Badge, cx } from '@djafat/ui';
import { Button, Input } from '@/components/ui-client';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;

export default function AdminRestaurantsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AdminRestaurantSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [balances, setBalances] = useState<Record<string, OwnerBalance[]>>({});

  const load = useCallback(
    async (p: number, q: string) => {
      setState('loading');
      try {
        const result = await api.admin.restaurants.list({
          ...(q ? { search: q } : {}),
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
    void load(1, '');
  }, [load]);

  async function loadBalance(id: string) {
    if (balances[id]) return;
    try {
      const result = await api.admin.restaurants.balance(id);
      setBalances((prev) => ({ ...prev, [id]: result }));
    } catch {
      // A missing balance is not fatal to the page — just leave it blank for this row.
    }
  }

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Restaurants</Heading>
      </div>

      <form
        className={cx(styles['searchRow'])}
        onSubmit={(e) => {
          e.preventDefault();
          void load(1, search);
        }}
      >
        <Input
          label="Rechercher"
          hideLabel
          placeholder="Nom du restaurant"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit">Rechercher</Button>
      </form>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des restaurants">
          <Skeleton height={40} />
          <Skeleton height={200} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les restaurants"
          action={<Button onClick={() => void load(page, search)}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState
          icon="🍽️"
          title="Aucun restaurant trouvé"
          message="Essayez une autre recherche."
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <DataTable
            keyFor={(r) => r.id}
            rows={items}
            columns={[
              { header: 'Nom', render: (r) => r.name },
              {
                header: 'Statut',
                render: (r) => (
                  <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>
                ),
              },
              {
                header: 'Solde (restant/dispo)',
                render: (r) => {
                  const bal = balances[r.id];
                  if (!bal) {
                    return (
                      <Button variant="ghost" size="sm" onClick={() => void loadBalance(r.id)}>
                        Afficher
                      </Button>
                    );
                  }
                  if (bal.length === 0) return '—';
                  return bal
                    .map((b) => `${formatMoney(b.pending)} / ${formatMoney(b.available)}`)
                    .join(', ');
                },
              },
            ]}
          />
          <Pagination
            page={page}
            limit={LIMIT}
            total={total}
            onPageChange={(p) => void load(p, search)}
          />
        </>
      )}
    </Stack>
  );
}
