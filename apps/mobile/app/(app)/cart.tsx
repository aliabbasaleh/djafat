import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { ApiClientError, type Address, type Cart, type CartQuote } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { Stepper } from '../../components/Stepper';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { newIdempotencyKey } from '../../lib/idempotency';
import { formatMoney } from '../../lib/format';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/(app)/cart` — cart + checkout (Bloc 12, docs/22 §3, §8-9). Mirrors
 * `apps/web`'s `/panier` exactly: `quote()` is the one live authoritative
 * recompute (never the cart's display-only snapshot), `orders.create`
 * takes the SAME `(idempotencyKey, addressId)` signature. Requires auth —
 * redirects to login with a `redirect` back here, same pattern as web.
 */
export default function CartScreen() {
  const router = useRouter();
  const { state: authState } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [cart, setCart] = useState<Cart | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const { cart: fetchedCart } = await api.cart.getCart();
      setCart(fetchedCart);
      if (fetchedCart && fetchedCart.items.length > 0) {
        try {
          setQuote(await api.cart.quote());
          setQuoteError(null);
        } catch (err) {
          setQuote(null);
          setQuoteError(
            err instanceof ApiClientError ? err.message : 'Impossible de calculer le total.',
          );
        }
      } else {
        setQuote(null);
        setQuoteError(null);
      }

      const fetchedAddresses = await api.addresses.list();
      setAddresses(fetchedAddresses);
      setSelectedAddressId((current) => {
        if (current && fetchedAddresses.some((a) => a.id === current)) return current;
        return (fetchedAddresses.find((a) => a.isDefault) ?? fetchedAddresses[0])?.id ?? null;
      });

      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push({ pathname: '/(auth)/login', params: { redirect: '/(app)/cart' } });
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    if (authState === 'signed-out') {
      router.replace({ pathname: '/(auth)/login', params: { redirect: '/(app)/cart' } });
      return;
    }
    if (authState === 'signed-in') void load();
  }, [authState, load, router]);

  async function updateQuantity(itemId: string, quantity: number) {
    setBusyItemId(itemId);
    try {
      await api.cart.updateItem(itemId, { quantity });
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  async function removeItem(itemId: string) {
    setBusyItemId(itemId);
    try {
      await api.cart.removeItem(itemId);
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  async function placeOrder() {
    setOrderError(null);
    setOrdering(true);
    try {
      const { order } = await api.orders.create(
        newIdempotencyKey(),
        selectedAddressId ?? undefined,
      );
      router.replace({ pathname: '/(app)/orders/[id]', params: { id: order.id } });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
        setOrderError('Cette adresse n’existe plus — choisissez-en une autre.');
        setAddresses(await api.addresses.list().catch(() => addresses));
      } else {
        setOrderError(
          err instanceof ApiClientError && err.code === 'CART_EMPTY'
            ? 'Votre panier est vide.'
            : 'Impossible de créer la commande. Réessayez.',
        );
      }
    } finally {
      setOrdering(false);
    }
  }

  if (authState !== 'signed-in' || state === 'loading') {
    return (
      <Screen>
        <Text style={styles.subtle}>Chargement…</Text>
      </Screen>
    );
  }
  if (state === 'error') {
    return (
      <Screen>
        <Text style={styles.subtle}>Impossible de charger votre panier.</Text>
        <Button label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }
  if (!cart || cart.items.length === 0) {
    return (
      <Screen>
        <Text style={styles.title}>Mon panier</Text>
        <Text style={styles.subtle}>Votre panier est vide.</Text>
        <Button
          label="Découvrir les restaurants"
          onPress={() => router.push('/(app)/restaurants')}
        />
      </Screen>
    );
  }

  const lineByItemId = new Map((quote?.lines ?? []).map((line) => [line.cartItemId, line]));

  return (
    <Screen>
      <Text style={styles.title}>Mon panier</Text>

      {quoteError && <Text style={styles.errorText}>{quoteError}</Text>}

      {cart.items.map((item) => {
        const line = lineByItemId.get(item.id);
        const isBusy = busyItemId === item.id;
        return (
          <View key={item.id} style={styles.item}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>
                {formatMoney(line ? line.lineTotal : item.unitPrice)}
              </Text>
            </View>
            {item.options.length > 0 && (
              <Text style={styles.itemOptions}>{item.options.map((o) => o.name).join(', ')}</Text>
            )}
            <View style={styles.itemFooter}>
              <Stepper
                value={item.quantity}
                min={1}
                disabled={isBusy}
                onChange={(q) => void updateQuantity(item.id, q)}
              />
              <Pressable disabled={isBusy} onPress={() => void removeItem(item.id)}>
                <Text style={styles.removeLabel}>Retirer</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {quote && (
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Sous-total</Text>
            <Text style={styles.summaryValue}>{formatMoney(quote.subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Frais de livraison</Text>
            <Text style={styles.summaryValue}>{formatMoney(quote.deliveryFee)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>{formatMoney(quote.total)}</Text>
          </View>
        </View>
      )}

      <View style={styles.addressSection}>
        <View style={styles.addressHeader}>
          <Text style={styles.sectionTitle}>Adresse de livraison</Text>
          <Pressable onPress={() => router.push('/(app)/addresses')}>
            <Text style={styles.manageLink}>Gérer mes adresses</Text>
          </Pressable>
        </View>
        {addresses.length === 0 ? (
          <Text style={styles.warningText}>Ajoutez une adresse avant de commander.</Text>
        ) : (
          addresses.map((address) => {
            const selected = selectedAddressId === address.id;
            return (
              <Pressable
                key={address.id}
                style={styles.addressOption}
                onPress={() => setSelectedAddressId(address.id)}
              >
                <View style={[styles.optionMark, selected && styles.optionMarkChecked]} />
                <Text style={styles.addressLabel}>
                  {[address.label ?? 'Sans nom', address.quartier].filter(Boolean).join(' — ')}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>

      {orderError && <Text style={styles.errorText}>{orderError}</Text>}

      <Button
        label="Commander"
        fullWidth
        loading={ordering}
        disabled={!quote || !selectedAddressId}
        onPress={() => void placeOrder()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.text.primary,
    marginBottom: tokens.space['4'],
  },
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  item: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['3'],
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  itemName: {
    fontSize: tokens.type.size.h3,
    fontWeight: '600',
    color: tokens.color.text.primary,
    flex: 1,
  },
  itemPrice: {
    fontSize: tokens.type.size.h3,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  itemOptions: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['1'],
  },
  itemFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.space['3'],
  },
  removeLabel: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    textDecorationLine: 'underline',
  },
  summary: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['4'],
    marginTop: tokens.space['2'],
    gap: tokens.space['2'],
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  summaryValue: { fontSize: tokens.type.size.body, color: tokens.color.text.primary },
  summaryTotalLabel: {
    fontSize: tokens.type.size.h3,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  summaryTotalValue: {
    fontSize: tokens.type.size.h3,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  addressSection: { marginTop: tokens.space['5'] },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['2'],
  },
  sectionTitle: {
    fontSize: tokens.type.size.h3,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  manageLink: { fontSize: tokens.type.size.small, color: tokens.color.brand.primary },
  addressOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['3'],
    paddingVertical: tokens.space['2'],
  },
  addressLabel: { fontSize: tokens.type.size.body, color: tokens.color.text.primary },
  optionMark: {
    width: 20,
    height: 20,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    borderColor: tokens.color.border.strong,
  },
  optionMarkChecked: {
    backgroundColor: tokens.color.brand.primary,
    borderColor: tokens.color.brand.primary,
  },
  warningText: { fontSize: tokens.type.size.body, color: tokens.color.state.warning },
  errorText: {
    fontSize: tokens.type.size.body,
    color: tokens.color.state.danger,
    marginVertical: tokens.space['2'],
  },
});
