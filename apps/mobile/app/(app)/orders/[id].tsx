import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { ApiClientError, type Order, type OrderStatus } from '@djafat/sdk';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useRoomRealtime } from '../../../lib/realtime';
import { formatMoney } from '../../../lib/format';

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Brouillon',
  awaiting_payment: 'En attente de paiement',
  placed: 'Commande reçue',
  confirmed: 'Confirmée par le restaurant',
  preparing: 'En préparation',
  ready: 'Prête',
  courier_assigned: 'Livreur assigné',
  picked_up: 'Récupérée',
  on_the_way: 'En route',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  rejected: 'Refusée',
  expired: 'Expirée',
};

type LoadState = 'loading' | 'ready' | 'error' | 'not-found';

/**
 * The customer's delivery code (audit finding FE-03): the courier asks for it
 * at the door and cannot finish the delivery without it. The API serves it to
 * the order's customer only, from the courier's pickup until the handover;
 * the screen shows it while the order is on its way.
 */
function DeliveryCodeCard({ orderId }: { orderId: string }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let deliveryId: string | null = null;
    const tick = async () => {
      try {
        deliveryId ??= (await api.orders.tracking(orderId)).deliveryId;
        if (!deliveryId) return;
        const res = await api.orders.deliveryCode(deliveryId);
        if (!stop) setCode(res.code);
      } catch (err) {
        // 404: no code yet, already used or expired. Anything else: keep the screen as is.
        if (!stop && err instanceof ApiClientError && err.status === 404) setCode(null);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [orderId]);
  if (!code) return null;
  return (
    <View style={styles.deliveryCode} accessibilityLabel="Code de livraison">
      <Text style={styles.deliveryCodeLabel}>Votre code de livraison</Text>
      <Text style={styles.deliveryCodeValue}>{code}</Text>
      <Text style={styles.deliveryCodeHint}>
        Donnez-le au livreur à son arrivée, et à personne d’autre.
      </Text>
    </View>
  );
}

/**
 * `/(app)/orders/[id]` — order confirmation + tracking (Bloc 12, docs/22 §9,
 * docs/27 §9/§18). Same discipline as `apps/web`'s `/commandes/[id]`: the
 * REST read is the ONE source of truth; `order:{id}` realtime is only ever a
 * hint to refetch it, never a payload applied by hand.
 */
export default function OrderTrackingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state: authState, accessToken } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [order, setOrder] = useState<Order | null>(null);

  const loadOrder = useCallback(async () => {
    try {
      const fetched = await api.orders.get(id);
      setOrder(fetched);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push({ pathname: '/(auth)/login', params: { redirect: `/(app)/orders/${id}` } });
        return;
      }
      setState(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'error');
    }
  }, [id, router]);

  useEffect(() => {
    if (authState === 'signed-out') {
      router.replace({ pathname: '/(auth)/login', params: { redirect: `/(app)/orders/${id}` } });
      return;
    }
    if (authState === 'signed-in') void loadOrder();
  }, [authState, id, loadOrder, router]);

  const realtimeStatus = useRoomRealtime(
    state === 'ready' ? `order:${id}` : null,
    accessToken,
    loadOrder,
  );

  if (authState !== 'signed-in' || state === 'loading') {
    return (
      <Screen>
        <Text style={styles.subtle}>Chargement…</Text>
      </Screen>
    );
  }
  if (state === 'not-found') {
    return (
      <Screen>
        <Text style={styles.subtle}>Cette commande n’existe pas ou ne vous appartient pas.</Text>
        <Button
          label="Retour aux restaurants"
          onPress={() => router.replace('/(app)/restaurants')}
        />
      </Screen>
    );
  }
  if (state === 'error' || !order) {
    return (
      <Screen>
        <Text style={styles.subtle}>Impossible de charger cette commande.</Text>
        <Button label="Réessayer" onPress={() => void loadOrder()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.code}>Commande {order.code}</Text>
      <Text style={styles.title}>Merci pour votre commande !</Text>
      <View style={styles.statusBadge}>
        <Text style={styles.statusLabel}>{STATUS_LABEL[order.status]}</Text>
      </View>
      <Text style={styles.realtimeNote}>
        {realtimeStatus === 'live'
          ? 'Suivi en direct activé'
          : 'Suivi en direct indisponible — tirez pour rafraîchir'}
      </Text>
      {(order.status === 'picked_up' || order.status === 'on_the_way') && (
        <DeliveryCodeCard orderId={order.id} />
      )}

      {order.items.map((item, index) => (
        <View key={index} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemName}>
              {item.quantity}× {item.name}
            </Text>
            <Text style={styles.itemPrice}>{formatMoney(item.lineTotal)}</Text>
          </View>
          {item.options.length > 0 && (
            <Text style={styles.itemOptions}>{item.options.map((o) => o.name).join(', ')}</Text>
          )}
        </View>
      ))}

      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Sous-total</Text>
          <Text style={styles.summaryValue}>{formatMoney(order.subtotal)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Frais de livraison</Text>
          <Text style={styles.summaryValue}>{formatMoney(order.deliveryFee)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryTotalLabel}>Total</Text>
          <Text style={styles.summaryTotalValue}>{formatMoney(order.total)}</Text>
        </View>
      </View>

      <Button
        label="Continuer mes achats"
        variant="secondary"
        fullWidth
        onPress={() => router.replace('/(app)/restaurants')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  code: { fontSize: tokens.type.size.small, color: tokens.color.text.secondary },
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.text.primary,
    marginTop: tokens.space['1'],
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.color.state.infoBg,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space['3'],
    paddingVertical: tokens.space['1'],
    marginTop: tokens.space['3'],
  },
  statusLabel: {
    fontSize: tokens.type.size.small,
    color: tokens.color.state.info,
    fontWeight: '600',
  },
  realtimeNote: {
    fontSize: tokens.type.size.caption,
    color: tokens.color.text.muted,
    marginTop: tokens.space['2'],
  },
  deliveryCode: {
    alignItems: 'center',
    borderWidth: 2,
    borderColor: tokens.color.brand.primary,
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['4'],
    marginTop: tokens.space['4'],
    gap: tokens.space['1'],
  },
  deliveryCodeLabel: {
    fontSize: tokens.type.size.small,
    fontWeight: '600',
    color: tokens.color.text.secondary,
  },
  deliveryCodeValue: {
    fontSize: tokens.type.size.display,
    fontWeight: '800',
    letterSpacing: 8,
    color: tokens.color.text.primary,
  },
  deliveryCodeHint: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    textAlign: 'center',
  },
  item: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginTop: tokens.space['3'],
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  itemName: {
    fontSize: tokens.type.size.body,
    fontWeight: '600',
    color: tokens.color.text.primary,
    flex: 1,
  },
  itemPrice: {
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  itemOptions: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['1'],
  },
  summary: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['4'],
    marginTop: tokens.space['4'],
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
});
