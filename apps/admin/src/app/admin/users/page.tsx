'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminUserSummary } from '@djafat/sdk';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Input } from '@/components/ui-client';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;

export default function AdminUsersPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const load = useCallback(
    async (p: number, q: string) => {
      setState('loading');
      try {
        const result = await api.admin.users.search({
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

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Utilisateurs</Heading>
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
          placeholder="Téléphone ou nom"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit">Rechercher</Button>
      </form>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des utilisateurs">
          <Skeleton height={40} />
          <Skeleton height={200} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les utilisateurs"
          action={<Button onClick={() => void load(page, search)}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState
          icon="👤"
          title="Aucun utilisateur trouvé"
          message="Essayez une autre recherche."
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <DataTable
            keyFor={(u) => u.id}
            rows={items}
            columns={[
              { header: 'Téléphone', render: (u) => u.phone },
              { header: 'Nom', render: (u) => u.fullName ?? '—' },
              { header: 'Statut', render: (u) => u.status },
              {
                header: '',
                render: (u) => (
                  <Button variant="secondary" size="sm" href={`/admin/users/${u.id}`}>
                    Détail
                  </Button>
                ),
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
