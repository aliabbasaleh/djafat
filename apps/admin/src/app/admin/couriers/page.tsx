'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminCourierSummary } from '@djafat/sdk';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Badge, cx } from '@djafat/ui';
import { Button, Select, Alert } from '@/components/ui-client';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  online: 'success',
  offline: 'neutral',
  busy: 'warning',
  suspended: 'danger',
};

export default function AdminCouriersPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AdminCourierSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number, status: string) => {
      setState('loading');
      try {
        const result = await api.admin.couriers.list({
          ...(status ? { status } : {}),
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

  async function toggleSuspend(c: AdminCourierSummary) {
    const suspending = c.status !== 'suspended';
    const verb = suspending ? 'suspendre' : 'réintégrer';
    if (!window.confirm(`Confirmez-vous vouloir ${verb} ce livreur ?`)) return;
    setActionError(null);
    setBusyId(c.userId);
    try {
      if (suspending) await api.admin.couriers.suspend(c.userId);
      else await api.admin.couriers.reinstate(c.userId);
      await load(page, statusFilter);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Livreurs</Heading>
      </div>

      <div className={cx(styles['filterRow'])}>
        <Select
          label="Statut"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            void load(1, e.target.value);
          }}
        >
          <option value="">Tous</option>
          <option value="online">En ligne</option>
          <option value="offline">Hors ligne</option>
          <option value="busy">Occupé</option>
          <option value="suspended">Suspendu</option>
        </Select>
      </div>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des livreurs">
          <Skeleton height={40} />
          <Skeleton height={200} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les livreurs"
          action={<Button onClick={() => void load(page, statusFilter)}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState icon="🛵" title="Aucun livreur trouvé" />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <DataTable
            keyFor={(c) => c.userId}
            rows={items}
            columns={[
              { header: 'ID', render: (c) => c.userId },
              {
                header: 'Statut',
                render: (c) => <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>,
              },
              {
                header: '',
                render: (c) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busyId === c.userId}
                    onClick={() => void toggleSuspend(c)}
                  >
                    {c.status === 'suspended' ? 'Réintégrer' : 'Suspendre'}
                  </Button>
                ),
              },
            ]}
          />
          <Pagination
            page={page}
            limit={LIMIT}
            total={total}
            onPageChange={(p) => void load(p, statusFilter)}
          />
        </>
      )}
    </Stack>
  );
}
