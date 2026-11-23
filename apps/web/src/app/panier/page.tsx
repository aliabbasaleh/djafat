'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ApiClientError, type Address, type Cart, type CartQuote } from '@djafat/sdk';
import { Container, Heading, Text, Stack, EmptyState, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Radio, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated, clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import {
  RETRY_DELAYS_S,
  isTransient,
  newOrderKey,
  offlineLinks,
  offlineOrderText,
} from '@/lib/offline-order';

/** DJAFAT's number for orders sent by WhatsApp / SMS (FEAT-017); no panel without it. */
const ORDER_NUMBER = process.env['NEXT_PUBLIC_DJAFAT_ORDER_NUMBER'] ?? '';
/** Number to call (may differ from the WhatsApp/SMS one). */
const CALL_NUMBER = process.env['NEXT_PUBLIC_DJAFAT_CALL_NUMBER'] || ORDER_NUMBER;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
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
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  // FEAT-017: one key per order attempt, kept across retries and shared with
  // the WhatsApp/SMS message, so the order is created once whatever gets through.
  const orderKey = useRef<string | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [offlinePayment, setOfflinePayment] = useState<'cash' | 'airtel'>('cash');

  const load = useCallback(async () => {
    if (!isAuthenticated()) {
      router.push('/compte?redirect=%2Fpanier' as Route);
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

      // Needed to pick a delivery address at checkout (Bloc 8, docs/29
      // §checkout) — fetched even when the cart has no quote yet, so the
      // "no address on file" guidance can show up immediately.
      const fetchedAddresses = await api.addresses.list();
      setAddresses(fetchedAddresses);
      setSelectedAddressId((current) => {
        if (current && fetchedAddresses.some((a) => a.id === current)) return current;
        return (fetchedAddresses.find((a) => a.isDefault) ?? fetchedAddresses[0])?.id ?? null;
      });

      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.push('/compte?redirect=%2Fpanier' as Route);
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
    setOffline(false);
    setOrdering(true);
    orderKey.current ??= newOrderKey();
    const key = orderKey.current;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const { order } = await api.orders.create(key, selectedAddressId ?? undefined);
          orderKey.current = null;
          window.dispatchEvent(new Event('djafat:cart-changed'));
          router.push(`/commandes/${order.id}` as Route);
          return;
        } catch (err) {
          const wait = RETRY_DELAYS_S[attempt];
          if (!isTransient(err) || wait === undefined) throw err;
          setRetryIn(wait);
          await sleep(wait);
          setRetryIn(null);
        }
      }
    } catch (err) {
      if (isTransient(err)) {
        setOffline(true); // same key: "Commander" again, or send it by message
      } else if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
        orderKey.current = null;
        setOrderError('Cette adresse n’existe plus — choisissez-en une autre.');
        setAddresses(await api.addresses.list().catch(() => addresses));
      } else {
        orderKey.current = null;
        setOrderError(
          err instanceof ApiClientError && err.code === 'CART_EMPTY'
            ? 'Votre panier est vide.'
            : 'Impossible de créer la commande. Vérifiez votre panier et réessayez.',
        );
      }
    } finally {
      setRetryIn(null);
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

        <div className={cx(styles['addressSection'])}>
          <div className={cx(styles['addressSectionHeader'])}>
            <Text weight="bold">Adresse de livraison</Text>
            <Button variant="ghost" size="sm" href="/adresses">
              Gérer mes adresses
            </Button>
          </div>
          {addresses.length === 0 ? (
            <Alert tone="warning">Ajoutez une adresse de livraison avant de commander.</Alert>
          ) : (
            <Stack gap="xs" className={cx(styles['addressList'])}>
              {addresses.map((address) => (
                <Radio
                  key={address.id}
                  name="delivery-address"
                  label={[address.label ?? 'Sans nom', address.quartier]
                    .filter(Boolean)
                    .join(' — ')}
                  checked={selectedAddressId === address.id}
                  onChange={() => setSelectedAddressId(address.id)}
                />
              ))}
            </Stack>
          )}
        </div>

        {orderError && <ErrorState title="Commande impossible" message={orderError} />}

        {retryIn !== null && (
          <Alert tone="info">Connexion instable — nouvel essai dans {retryIn} s…</Alert>
        )}

        {offline && (
          <OfflinePanel
            text={
              orderKey.current && selectedAddressId
                ? offlineOrderText(cart, selectedAddressId, offlinePayment, orderKey.current)
                : null
            }
            payment={offlinePayment}
            onPayment={setOfflinePayment}
          />
        )}

        <Button
          fullWidth
          loading={ordering}
          disabled={!quote || !selectedAddressId}
          onClick={() => void placeOrder()}
        >
          {offline ? 'Réessayer l’envoi par Internet' : 'Commander'}
        </Button>
      </Stack>
    </Container>
  );
}

/** FEAT-017 — the order by WhatsApp or SMS, or a call, when the data connection is down. */
function OfflinePanel({
  text,
  payment,
  onPayment,
}: {
  text: string | null;
  payment: 'cash' | 'airtel';
  onPayment: (p: 'cash' | 'airtel') => void;
}) {
  const links = text && ORDER_NUMBER ? offlineLinks(ORDER_NUMBER, text, CALL_NUMBER) : null;
  return (
    <section className={cx(styles['offlinePanel'])} aria-label="Commander par message">
      <Text weight="bold">Pas de connexion Internet ?</Text>
      <Text size="small" tone="secondary">
        Envoyez la même commande par message : vous recevez la réponse avec le numéro de commande et
        le code à donner au livreur. Elle ne sera jamais passée deux fois.
      </Text>
      <Stack gap="xs">
        <Radio
          name="offline-payment"
          label="Espèces à la livraison"
          checked={payment === 'cash'}
          onChange={() => onPayment('cash')}
        />
        <Radio
          name="offline-payment"
          label="Airtel Money"
          checked={payment === 'airtel'}
          onChange={() => onPayment('airtel')}
        />
      </Stack>
      {links ? (
        <div className={cx(styles['offlineActions'])}>
          <Button href={links.whatsapp} fullWidth>
            Envoyer par WhatsApp
          </Button>
          <Button href={links.sms} variant="secondary" fullWidth>
            Envoyer par SMS
          </Button>
          <Button href={links.call} variant="ghost" fullWidth>
            Appeler DJAFAT
          </Button>
        </div>
      ) : (
        <Alert tone="warning">Réessayez dans un instant.</Alert>
      )}
    </section>
  );
}
