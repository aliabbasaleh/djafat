'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminOrderSummary } from '@djafat/sdk';
import { ORDER_STATUSES } from '@djafat/types';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Badge, cx } from '@djafat/ui';
import { Alert, Button, Select, Input } from '@/components/ui-client';
import { useStepUp } from '@/components/StepUp';
import { DataTable, Pagination } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession, getStoredUser, isFullAdmin } from '@/lib/auth-storage';
import { StepUpCancelled } from '@/lib/step-up-flow';
import { formatMoney } from '@/lib/format';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const LIMIT = 20;
/**
 * Staff may cancel an order awaiting payment (`customer_cancel` lists them
 * too) and any order up to the courier's pickup (`admin_force_cancel`), as the
 * order state machine says (ORD-01).
 */
const CANCELLABLE = new Set([
  'awaiting_payment',
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'courier_assigned',
]);

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
  const withStepUp = useStepUp();
  const [canCancel, setCanCancel] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => setCanCancel(isFullAdmin(getStoredUser())), []);

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

  /**
   * ORD-01: staff cancel an order up to the courier's pickup; the delivery
   * stops and a paid order is refunded automatically (PAY-04). A recent MFA
   * step-up is required: `withStepUp` asks for the code on 428.
   */
  async function cancelOrder(order: AdminOrderSummary) {
    const reason = window.prompt(`Annuler la commande ${order.code} ? Raison (obligatoire) :`);
    if (!reason || !reason.trim()) return;
    setBusyId(order.id);
    setMessage(null);
    try {
      await withStepUp(() => api.admin.orders.cancel(order.id, reason.trim()));
      setMessage({
        tone: 'success',
        text: `Commande ${order.code} annulée. Si elle était payée, le remboursement est lancé (voir Remboursements pour les portefeuilles marchands).`,
      });
      await load(page, statusFilter, restaurantId);
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      setMessage({
        tone: 'danger',
        text: err instanceof ApiClientError ? err.message : 'Annulation impossible.',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Commandes</Heading>
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

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
              ...(canCancel
                ? [
                    {
                      header: '',
                      render: (o: AdminOrderSummary) =>
                        CANCELLABLE.has(o.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busyId === o.id}
                            onClick={() => void cancelOrder(o)}
                          >
                            Annuler
                          </Button>
                        ) : null,
                    },
                  ]
                : []),
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
