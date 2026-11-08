'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { ApiClientError, type Order } from '@djafat/sdk';
import { Container, Heading, Text, Stack, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated, clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import { useRoomRealtime } from '@/lib/realtime';
import { OrderTracker } from '@/components/OrderTracker';
import { PaymentPicker } from '@/components/PaymentPicker';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error' | 'not-found';

/**
 * `/commandes/[id]` — order confirmation (docs/22 §9, §17.7). A Client
 * Component for the same reason as `/panier`: the auth token only exists
 * in the browser. `useParams()` rather than the `params` prop — the
 * documented pattern for a Client Component page (docs/22 §17.6).
 */
export default function OrderConfirmationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [order, setOrder] = useState<Order | null>(null);

  /**
   * The ONE place the order is read (docs/27 §9, §18). Both the initial load
   * and every realtime nudge go through it, so the rendered state is always a
   * REST response and never an event payload applied by hand.
   */
  const loadOrder = useCallback(async (): Promise<void> => {
    const redirectTarget = `/connexion?redirect=${encodeURIComponent(`/commandes/${params.id}`)}`;
    try {
      const fetched = await api.orders.get(params.id);
      setOrder(fetched);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.push(redirectTarget as Route);
        return;
      }
      setState(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'error');
    }
  }, [params.id, router]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push(`/connexion?redirect=${encodeURIComponent(`/commandes/${params.id}`)}` as Route);
      return;
    }
    void loadOrder();
  }, [loadOrder, params.id, router]);

  /**
   * Live status updates. The hook only ever asks us to refetch — it joins
   * `order:{id}`, which the server authorizes against this order's actual owner
   * (docs/27 §4), and refetches on connect, on reconnect, and on any event.
   * If the socket never connects, the page is exactly what it was before:
   * a REST read (docs/27 §1 — realtime is never the source of truth).
   */
  const realtimeStatus = useRoomRealtime(
    state === 'ready' ? `order:${params.id}` : null,
    loadOrder,
  );

  if (state === 'loading') {
    return (
      <Container
        as="main"
        maxWidth={640}
        className={cx(styles['main'])}
        aria-busy="true"
        aria-label="Chargement de la commande"
      >
        <Skeleton width={220} height={28} />
        <Skeleton height={120} radius="12px" className={cx(styles['skeletonBlock'])} />
      </Container>
    );
  }

  if (state === 'not-found') {
    return (
      <Container as="main" maxWidth={640} className={cx(styles['main'])}>
        <ErrorState
          title="Commande introuvable"
          message="Cette commande n'existe pas ou ne vous appartient pas."
          action={<Button href="/restaurants">Retour aux restaurants</Button>}
        />
      </Container>
    );
  }

  if (state === 'error' || !order) {
    return (
      <Container as="main" maxWidth={640} className={cx(styles['main'])}>
        <ErrorState title="Impossible de charger la commande" />
      </Container>
    );
  }

  return (
    <Container as="main" maxWidth={640} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Text tone="secondary" size="small">
            Commande {order.code}
          </Text>
          <Heading level={1}>Merci pour votre commande !</Heading>
        </Stack>

        <OrderTracker status={order.status} />
        {order.status === 'awaiting_payment' && (
          <PaymentPicker orderId={order.id} onChanged={() => void loadOrder()} />
        )}

        <Stack gap="xs">
          {/*
            Honest about the transport: "en direct" when the socket is up,
            otherwise it says the page still updates — because it genuinely
            does, on the next load. Never claims live updates it is not
            receiving (docs/27 §17).
          */}
          <Text size="small" tone="secondary">
            {realtimeStatus === 'live'
              ? 'Suivi en direct activé'
              : 'Suivi en direct indisponible — rechargez pour voir le dernier statut'}
          </Text>
        </Stack>

        <ul className={cx(styles['items'])}>
          {order.items.map((item, index) => (
            <li key={index} className={cx(styles['item'])}>
              <div className={cx(styles['itemHeader'])}>
                <Text weight="bold">
                  {item.quantity}× {item.name}
                </Text>
                <Text weight="bold">{formatMoney(item.lineTotal)}</Text>
              </div>
              {item.options.length > 0 && (
                <Text size="small" tone="secondary">
                  {item.options.map((o) => o.name).join(', ')}
                </Text>
              )}
            </li>
          ))}
        </ul>

        <div className={cx(styles['summary'])}>
          <div className={cx(styles['summaryRow'])}>
            <Text>Sous-total</Text>
            <Text>{formatMoney(order.subtotal)}</Text>
          </div>
          <div className={cx(styles['summaryRow'])}>
            <Text>Frais de livraison</Text>
            <Text>{formatMoney(order.deliveryFee)}</Text>
          </div>
          <div className={cx(styles['summaryRow'], styles['summaryTotal'])}>
            <Text weight="bold">Total</Text>
            <Text weight="bold" tone="brand">
              {formatMoney(order.total)}
            </Text>
          </div>
        </div>

        <Button href="/restaurants" fullWidth variant="secondary">
          Continuer mes achats
        </Button>
      </Stack>
    </Container>
  );
}
