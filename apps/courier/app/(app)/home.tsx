import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { CourierApplication, CourierProfile, Delivery, DeliveryOffer } from '@djafat/sdk';
import { ApiClientError } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { Badge } from '../../components/Badge';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useCourierRealtime } from '../../lib/realtime';
import { useForegroundLocationReporting } from '../../lib/location';
import { newIdempotencyKey } from '../../lib/idempotency';
import { secondsRemaining, formatCountdown, formatMoney } from '../../lib/format';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * FEAT-022 (SPEC-022-06 R5): a courier who signed up has an application and
 * waits for DJAFAT; one created by the team has none and works as before.
 */
async function applicationOrNone(): Promise<CourierApplication | null> {
  try {
    return await api.courier.application.get();
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'APPLICATION_NOT_FOUND') return null;
    throw err;
  }
}

function salutation(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Bonne nuit';
  if (hour < 18) return 'Bonjour';
  return 'Bonsoir';
}

/**
 * Home — online/offline (giant toggle) + incoming offer (docs/04 §4.7). One
 * primary action at a time: offline → "go online"; online & idle → "go
 * offline" + waiting message; an offer arrives → accept/refuse with a
 * countdown; an active delivery exists → a single button to resume it.
 * Realtime (`courier:{id}`) is a hint to refetch, never applied directly —
 * same discipline as every other realtime screen in this repo.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  // Dispatch only offers a course to a courier whose position is fresh: report it while online.
  useForegroundLocationReporting(profile?.status === 'online');
  const [offer, setOffer] = useState<DeliveryOffer | null>(null);
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [p, offers, active, application] = await Promise.all([
        api.courier.getProfile(),
        api.courier.offers.list(),
        api.courier.deliveries.listActive(),
        applicationOrNone(),
      ]);
      if (application && application.status !== 'approved') {
        router.replace('/(app)/onboarding');
        return;
      }
      setProfile(p);
      setOffer(offers[0] ?? null);
      setActiveDelivery(active[0] ?? null);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return;
      }
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PRE-EXISTING (FU-REACT-01): `signOut` is read stale; adding it changes the callback identity, review separately.
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useCourierRealtime(load);

  // Countdown tick, only while an offer is showing.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!offer) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [offer]);

  async function toggleOnline() {
    if (!profile) return;
    setBusy(true);
    try {
      await api.courier.setStatus(profile.status === 'online' ? 'offline' : 'online');
      await load();
    } catch {
      // Refetch surfaces the server's actual state (e.g. "cannot go offline with an active delivery").
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function respondToOffer(accept: boolean) {
    if (!offer) return;
    setBusy(true);
    try {
      const action = accept ? api.courier.offers.accept : api.courier.offers.reject;
      await action(offer.deliveryId, newIdempotencyKey());
      await load();
      if (accept) router.push('/(app)/delivery');
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Chargement…</Text>
      </Screen>
    );
  }
  if (state === 'error' || !profile) {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
        <BigButton label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }

  const remaining = offer ? secondsRemaining(offer.expiresAt, now) : 0;

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {salutation()}
          {user?.fullName ? `, ${user.fullName}` : ''} 👋
        </Text>
        <BigButton label="Déconnexion" variant="ghost" onPress={() => void signOut()} />
      </View>

      {offer ? (
        <View style={styles.offerCard}>
          <Badge tone="info" label={`Nouvelle course — ${formatCountdown(remaining)}`} />
          {offer.context.customerIsNew && (
            <Badge tone="warning" label="Nouveau client — appelez-le avant de partir" />
          )}
          <Text style={styles.offerTitle}>{offer.context.restaurantName}</Text>
          <Text style={styles.offerDetail}>
            {offer.context.restaurantAddress ?? 'Adresse non renseignée'}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.offerLabel}>Livrer à</Text>
          <Text style={styles.offerDetail}>
            {offer.context.dropoffAddress ?? offer.context.dropoffLabel ?? 'Adresse non renseignée'}
          </Text>
          <View style={styles.offerFeeRow}>
            <Text style={styles.offerLabel}>Gain estimé</Text>
            <Text style={styles.offerFee}>{formatMoney(offer.context.courierFee)}</Text>
          </View>
          <View style={styles.offerActions}>
            <View style={styles.offerActionButton}>
              <BigButton
                label="Accepter"
                onPress={() => void respondToOffer(true)}
                disabled={busy || remaining === 0}
              />
            </View>
            <View style={styles.offerActionButton}>
              <BigButton
                label="Refuser"
                variant="danger"
                onPress={() => void respondToOffer(false)}
                disabled={busy}
              />
            </View>
          </View>
        </View>
      ) : activeDelivery ? (
        <View style={styles.centered}>
          <Badge tone="info" label="Livraison en cours" />
          <Text style={styles.offerTitle}>{activeDelivery.context?.restaurantName}</Text>
          <BigButton
            label="Reprendre la livraison"
            onPress={() => router.push('/(app)/delivery')}
          />
        </View>
      ) : (
        <View style={styles.centered}>
          <Badge
            tone={profile.status === 'online' ? 'success' : 'neutral'}
            label={profile.status === 'online' ? 'En ligne' : 'Hors ligne'}
          />
          {profile.status === 'online' && (
            <Text style={styles.subtle}>En attente d’une course…</Text>
          )}
          <BigButton
            label={profile.status === 'online' ? 'Passer hors ligne' : 'Passer en ligne'}
            variant={profile.status === 'online' ? 'secondary' : 'primary'}
            onPress={() => void toggleOnline()}
            loading={busy}
          />
        </View>
      )}

      <View style={styles.footerLinks}>
        <BigButton label="Gains" variant="ghost" onPress={() => router.push('/(app)/earnings')} />
        {/* FEAT-022 (SPEC-022-07 R6): replace a paper once validated. */}
        <BigButton
          label="Mes papiers"
          variant="ghost"
          onPress={() => router.push('/(app)/papers')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['6'],
  },
  greeting: { fontSize: tokens.type.size.h2, fontWeight: '700', color: tokens.color.text.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: tokens.space['4'] },
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    textAlign: 'center',
  },
  offerCard: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['5'],
    gap: tokens.space['2'],
  },
  offerTitle: {
    fontSize: tokens.type.size.h1,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  offerLabel: {
    fontSize: tokens.type.size.label,
    color: tokens.color.text.muted,
    marginTop: tokens.space['2'],
  },
  offerDetail: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  divider: {
    height: 1,
    backgroundColor: tokens.color.border.default,
    marginVertical: tokens.space['2'],
  },
  offerFeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.space['2'],
  },
  offerFee: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.brand.primary },
  offerActions: { flexDirection: 'row', gap: tokens.space['3'], marginTop: tokens.space['4'] },
  offerActionButton: { flex: 1 },
  footerLinks: { marginTop: tokens.space['4'] },
});
