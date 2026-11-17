'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type RestaurantOrderSummary } from '@djafat/sdk';
import {
  Heading,
  Text,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  Stack,
  Greeting,
  cx,
} from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { OrderBoard } from '@/components/OrderBoard';
import { api } from '@/lib/api';
import { clearSession, getStoredUser } from '@/lib/auth-storage';
import { useRoomRealtime } from '@/lib/realtime';
import { playNewOrderChime, primeSound } from '@/lib/sound';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';
const SOUND_PREF_KEY = 'djafat.restaurant.sound-enabled';

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The kitchen's order board — the restaurant app's home screen (Bloc 10,
 * docs/33 §order-board). Realtime via `restaurant:orders:{id}` (Bloc 7) is a
 * hint to refetch, never a payload to apply (`useRoomRealtime`'s own doc
 * comment) — this page's `load()` is always what actually renders, so a
 * missed/out-of-order event can never show a stale or impossible board.
 */
export default function OrderBoardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [orders, setOrders] = useState<RestaurantOrderSummary[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const knownOrderIds = useRef<Set<string> | null>(null);

  useEffect(() => setSoundEnabled(readSoundPref()), []);
  useEffect(() => setOwnerName(getStoredUser()?.fullName ?? null), []);

  const handleUnauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  const load = useCallback(async () => {
    try {
      if (!restaurantId) {
        const profile = await api.restaurant.getMine();
        setRestaurantId(profile.id);
      }
      const result = await api.restaurant.orders.list();
      const items = [...result.items];

      // Chime on a NEWLY-seen order sitting in "placed" — never on the
      // first load (that would beep for the whole existing queue on every
      // page refresh) and never for a status CHANGE (only a brand-new id).
      if (knownOrderIds.current !== null) {
        const isNew = items.some((o) => o.status === 'placed' && !knownOrderIds.current!.has(o.id));
        if (isNew && soundEnabled) playNewOrderChime();
      }
      knownOrderIds.current = new Set(items.map((o) => o.id));

      setOrders(items);
      setState('ready');
    } catch (err) {
      if (handleUnauthorized(err)) return;
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PRE-EXISTING (FU-REACT-01): `restaurantId` is read stale; adding it changes refetch behaviour, review separately.
  }, [handleUnauthorized, soundEnabled]);

  // Only on mount — `load` itself changes identity when `soundEnabled`
  // toggles, and re-running the fetch on every toggle would be wasteful; the
  // realtime subscription (below) + its own refetch-on-(re)connect cover
  // freshness after that.
  useEffect(() => {
    void load();
    // intentionally run once — see comment above
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design (see comment above)
  }, []);

  const realtimeStatus = useRoomRealtime(
    restaurantId ? `restaurant:orders:${restaurantId}` : null,
    load,
  );

  async function act(action: Promise<unknown>) {
    try {
      await action;
      await load();
    } catch (err) {
      if (handleUnauthorized(err)) return;
      // A failed action (e.g. a concurrent status change) is surfaced by
      // simply refetching — the board then shows the order's ACTUAL current
      // state rather than a stale optimistic one.
      await load();
    }
  }

  function toggleSound() {
    primeSound(); // must run inside this click handler — browser audio-gesture requirement
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      window.localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0');
    } catch {
      // Best-effort — sound just won't persist across reloads.
    }
  }

  return (
    <Stack gap="lg">
      <Greeting
        name={ownerName}
        message="Voici les commandes de votre établissement, mises à jour en direct."
      />

      <div className={cx(styles['header'])}>
        <Heading level={1}>Commandes</Heading>
        <Stack gap="xs" align="end">
          <Button size="sm" variant={soundEnabled ? 'secondary' : 'ghost'} onClick={toggleSound}>
            {soundEnabled ? '🔊 Son activé' : '🔈 Activer le son'}
          </Button>
          <Badge tone={realtimeStatus === 'live' ? 'success' : 'neutral'} dot>
            {realtimeStatus === 'live' ? 'Temps réel actif' : 'Hors ligne — actualisation manuelle'}
          </Badge>
        </Stack>
      </div>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des commandes">
          <Skeleton height={40} />
          <Skeleton height={240} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les commandes"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && orders.length === 0 && (
        <EmptyState
          icon="🧾"
          title="Aucune commande en cours"
          message="Le tableau se met à jour automatiquement."
        />
      )}

      {state === 'ready' && orders.length > 0 && (
        <OrderBoard
          orders={orders}
          onConfirm={(id) => act(api.restaurant.orders.confirm(id))}
          onReject={(id, reason) => act(api.restaurant.orders.reject(id, reason))}
          onReady={(id) => act(api.restaurant.orders.ready(id))}
        />
      )}

      <Text size="small" tone="muted">
        Les commandes livrées/annulées apparaissent dans l’
        <a href="/restaurant/history">historique</a>.
      </Text>
    </Stack>
  );
}
