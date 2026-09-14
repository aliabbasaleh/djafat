'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ApiClientError, type Cart, type CartQuote } from '@djafat/sdk';
import { Container, Heading, Text, Stack, EmptyState, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated, clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/panier` — cart view + checkout (docs/22 §3, §8, §9, §17.6). Entirely a
 * Client Component: cart state lives server-side keyed to the caller's
 * token, which is only readable from the browser (docs/22 §17.3). `quote()`
 * is the one live, authoritative recompute — displayed prices always come
 * from it, never from the cart's display-only snapshot, except as a
 * last-resort fallback while a quote is unavailable.
 */
export default function PanierPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [cart, setCart] = useState<Cart | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated()) {
      router.push('/connexion?redirect=%2Fpanier' as Route);
      return;
    }
    setState('loading');
    try {
      const { cart: fetchedCart } = await api.cart.getCart();
      setCart(fetchedCart);
      if (fetchedCart && fetchedCart.items.length > 0) {
        try {
          const fetchedQuote = await api.cart.quote();
          setQuote(fetchedQuote);
          setQuoteError(null);
        } catch (err) {
          setQuote(null);
          setQuoteError(
            err instanceof ApiClientError
              ? err.message
              : 'Impossible de calculer le total pour le moment.',
          );
        }
      } else {
        setQuote(null);
        setQuoteError(null);
      }
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.push('/connexion?redirect=%2Fpanier' as Route);
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateQuantity(itemId: string, quantity: number) {
    setBusyItemId(itemId);
    try {
      await api.cart.updateItem(itemId, { quantity });
      window.dispatchEvent(new Event('djafat:cart-changed'));
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  async function removeItem(itemId: string) {
    setBusyItemId(itemId);
    try {
      await api.cart.removeItem(itemId);
      window.dispatchEvent(new Event('djafat:cart-changed'));
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  async function clearCart() {
    setBusyItemId('__clear__');
    try {
      await api.cart.clear();
      window.dispatchEvent(new Event('djafat:cart-changed'));
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  async function placeOrder() {
    setOrderError(null);
    setOrdering(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const { order } = await api.orders.create(idempotencyKey);
      window.dispatchEvent(new Event('djafat:cart-changed'));
      router.push(`/commandes/${order.id}` as Route);
    } catch (err) {
      setOrderError(
        err instanceof ApiClientError && err.code === 'CART_EMPTY'
          ? 'Votre panier est vide.'
          : 'Impossible de créer la commande. Vérifiez votre panier et réessayez.',
      );
    } finally {
      setOrdering(false);
    }
  }

  if (state === 'loading') {
    return (
      <Container
        as="main"
        className={cx(styles['main'])}
        aria-busy="true"
        aria-label="Chargement du panier"
      >
        <Skeleton width={160} height={28} />
        <Skeleton height={80} radius="12px" className={cx(styles['skeletonRow'])} />
        <Skeleton height={80} radius="12px" className={cx(styles['skeletonRow'])} />
      </Container>
    );
  }

  if (state === 'error') {
    return (
      <Container as="main" className={cx(styles['main'])}>
        <ErrorState
          title="Impossible de charger votre panier"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      </Container>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <Container as="main" className={cx(styles['main'])}>
        <EmptyState
          icon="🛒"
          title="Votre panier est vide"
          message="Parcourez les restaurants pour commencer une commande."
          action={<Button href="/restaurants">Découvrir les restaurants</Button>}
        />
      </Container>
    );
  }

  const lineByItemId = new Map((quote?.lines ?? []).map((line) => [line.cartItemId, line]));

  return (
    <Container as="main" maxWidth={720} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Heading level={1}>Mon panier</Heading>

        {quoteError && <ErrorState title="Total indisponible" message={quoteError} />}

        <ul className={cx(styles['items'])}>
          {cart.items.map((item) => {
            const line = lineByItemId.get(item.id);
            const isBusy = busyItemId === item.id;
            return (
              <li key={item.id} className={cx(styles['item'])}>
                <div className={cx(styles['itemHeader'])}>
                  <Text weight="bold">{item.name}</Text>
                  <Text weight="bold" tone="brand">
                    {formatMoney(line ? line.lineTotal : item.unitPrice)}
                  </Text>
                </div>
                {item.options.length > 0 && (
                  <Text size="small" tone="secondary">
                    {item.options.map((o) => o.name).join(', ')}
                  </Text>
                )}
                <div className={cx(styles['itemFooter'])}>
                  <div className={cx(styles['stepper'])}>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Diminuer la quantité de ${item.name}`}
                      disabled={isBusy || item.quantity <= 1}
                      onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                    >
                      −
                    </Button>
                    <span className={cx(styles['quantityValue'])}>{item.quantity}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Augmenter la quantité de ${item.name}`}
                      disabled={isBusy}
                      onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                    >
                      +
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void removeItem(item.id)}
                  >
                    Retirer
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void clearCart()}
          disabled={busyItemId !== null}
        >
          Vider le panier
        </Button>

        {quote && (
          <div className={cx(styles['summary'])}>
            <div className={cx(styles['summaryRow'])}>
              <Text>Sous-total</Text>
              <Text>{formatMoney(quote.subtotal)}</Text>
            </div>
            <div className={cx(styles['summaryRow'])}>
              <Text>Frais de livraison</Text>
              <Text>{formatMoney(quote.deliveryFee)}</Text>
            </div>
            <div className={cx(styles['summaryRow'], styles['summaryTotal'])}>
              <Text weight="bold">Total</Text>
              <Text weight="bold" tone="brand">
                {formatMoney(quote.total)}
              </Text>
            </div>
          </div>
        )}

        {orderError && <ErrorState title="Commande impossible" message={orderError} />}

        <Button fullWidth loading={ordering} disabled={!quote} onClick={() => void placeOrder()}>
          Commander
        </Button>
      </Stack>
    </Container>
  );
}
