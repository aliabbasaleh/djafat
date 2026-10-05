import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { OwnerBalance } from '@djafat/sdk';
import { ApiClientError } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatMoney } from '../../lib/format';

type LoadState = 'loading' | 'ready' | 'error';

/** Read-only wallet statement (Bloc 11) — same `GET /couriers/me/balance` (Bloc 9) `apps/restaurant`'s wallet screen already reads, just the courier-owned projection. No payout UI (V1.x, docs/14 §14.1 exclusions). */
export default function EarningsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [balances, setBalances] = useState<readonly OwnerBalance[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await api.courier.getBalance();
      setBalances(result);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return;
      }
      setState('error');
    }
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Mes gains</Text>
        <BigButton label="Retour" variant="ghost" onPress={() => router.back()} />
      </View>

      {state === 'loading' && <Text style={styles.subtle}>Chargement…</Text>}
      {state === 'error' && (
        <>
          <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
          <BigButton label="Réessayer" onPress={() => void load()} />
        </>
      )}
      {state === 'ready' && balances.length === 0 && (
        <Text style={styles.subtle}>Aucun gain pour le moment.</Text>
      )}
      {state === 'ready' &&
        balances.map((b) => (
          <View key={b.currency} style={styles.card}>
            <Text style={styles.currency}>{b.currency}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>En attente (pending)</Text>
              <Text style={styles.value}>{formatMoney(b.pending)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Disponible</Text>
              <Text style={styles.value}>{formatMoney(b.available)}</Text>
            </View>
          </View>
        ))}
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
  title: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.text.primary },
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['5'],
    marginBottom: tokens.space['3'],
    gap: tokens.space['2'],
  },
  currency: { fontSize: tokens.type.size.label, color: tokens.color.text.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  value: { fontSize: tokens.type.size.h2, fontWeight: '700', color: tokens.color.text.primary },
});
