import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { Delivery } from '@djafat/sdk';
import { ApiClientError } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { Badge } from '../../components/Badge';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useForegroundLocationReporting } from '../../lib/location';
import { newIdempotencyKey } from '../../lib/idempotency';
import { formatMoney } from '../../lib/format';

type LoadState = 'loading' | 'ready' | 'error' | 'none';

const BEFORE_PICKUP: readonly string[] = [
  'courier_assigned',
  'courier_accepted',
  'pickup_in_progress',
];
const AFTER_PICKUP: readonly string[] = ['picked_up', 'on_the_way'];

/**
 * Active delivery (Bloc 11, docs/04 §4.7): go to restaurant → confirm pickup
 * → go to customer → confirm delivery with the 4-digit code the customer
 * reads out. Foreground location reporting runs for as long as this screen
 * is mounted with an active delivery — see `lib/location.ts` for exactly
 * what that does and does not cover.
 */
export default function DeliveryScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [failing, setFailing] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const active = await api.courier.deliveries.listActive();
      const current = active[0] ?? null;
      setDelivery(current);
      setState(current ? 'ready' : 'none');
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

  useForegroundLocationReporting(state === 'ready');

  async function confirmPickup() {
    if (!delivery) return;
    setBusy(true);
    setError(null);
    try {
      await api.courier.deliveries.pickup(delivery.id, newIdempotencyKey());
      await load();
    } catch {
      setError('Échec de la confirmation de récupération.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelivery() {
    if (!delivery) return;
    setBusy(true);
    setError(null);
    try {
      await api.courier.deliveries.deliver(delivery.id, code, newIdempotencyKey());
      router.replace('/(app)/home');
    } catch {
      setError('Code invalide — vérifiez-le auprès du client.');
    } finally {
      setBusy(false);
    }
  }

  /** FEAT-018 — the customer's ≤ 10 s voice note (« portail bleu après la boutique »). */
  async function playVoiceNote() {
    if (!delivery) return;
    setNoteMsg(null);
    if (Platform.OS !== 'web') {
      setNoteMsg('La note vocale s’écoute sur la version web de l’application.');
      return;
    }
    setNoteBusy(true);
    try {
      const note = await api.courier.deliveries.getVoiceNote(delivery.id);
      if (!note) {
        setNoteMsg('Le client a retiré sa note vocale.');
        return;
      }
      const AudioCtor = (globalThis as { Audio?: new (src: string) => { play(): Promise<void> } })
        .Audio;
      if (!AudioCtor) {
        setNoteMsg('Lecture audio indisponible sur cet appareil.');
        return;
      }
      await new AudioCtor(`data:${note.mime};base64,${note.dataBase64}`).play();
    } catch {
      setNoteMsg('Impossible de lire la note vocale — réessayez.');
    } finally {
      setNoteBusy(false);
    }
  }

  async function submitFail() {
    if (!delivery || failReason.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.courier.deliveries.fail(delivery.id, failReason.trim(), newIdempotencyKey());
      router.replace('/(app)/home');
    } catch {
      setError('Échec du signalement — réessayez.');
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
  if (state === 'none') {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Aucune livraison en cours.</Text>
        <BigButton label="Retour" onPress={() => router.replace('/(app)/home')} />
      </Screen>
    );
  }
  if (state === 'error' || !delivery) {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
        <BigButton label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }

  const beforePickup = BEFORE_PICKUP.includes(delivery.status);
  const afterPickup = AFTER_PICKUP.includes(delivery.status);
  const context = delivery.context;

  return (
    <Screen>
      <Badge tone="info" label={beforePickup ? 'Direction le restaurant' : 'Direction le client'} />
      {beforePickup && context?.customerIsNew && (
        <Badge tone="warning" label="Nouveau client — appelez-le avant de quitter le restaurant" />
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>{beforePickup ? 'Récupérer à' : 'Livrer à'}</Text>
        <Text style={styles.cardTitle}>
          {beforePickup ? context?.restaurantName : (context?.dropoffLabel ?? 'Client')}
        </Text>
        <Text style={styles.cardDetail}>
          {beforePickup ? context?.restaurantAddress : context?.dropoffAddress}
        </Text>
        {beforePickup && context?.restaurantPhone && (
          <Text style={styles.cardDetail}>Tél. restaurant : {context.restaurantPhone}</Text>
        )}
        {afterPickup && context?.dropoffDoorHint && (
          <View style={styles.doorHint} accessibilityRole="text">
            <Text style={styles.doorHintLabel}>Indication pour le portail</Text>
            <Text style={styles.doorHintText}>{context.dropoffDoorHint}</Text>
          </View>
        )}
        {afterPickup && context?.dropoffPhone && (
          <Text style={styles.cardDetail}>Tél. client : {context.dropoffPhone}</Text>
        )}
        {afterPickup && context?.dropoffHasVoiceNote && (
          <View style={styles.noteBox}>
            <BigButton
              label="▶ Écouter la note du client"
              variant="secondary"
              onPress={() => void playVoiceNote()}
              loading={noteBusy}
            />
            {noteMsg && <Text style={styles.cardDetail}>{noteMsg}</Text>}
          </View>
        )}
        <View style={styles.divider} />
        <Text style={styles.cardLabel}>Gain de cette course</Text>
        <Text style={styles.fee}>{formatMoney(delivery.courierFee)}</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {beforePickup && (
        <BigButton
          label="Confirmer la récupération"
          onPress={() => void confirmPickup()}
          loading={busy}
        />
      )}

      {afterPickup && !failing && (
        <View style={styles.form}>
          <Text style={styles.cardLabel}>Code de livraison (donné par le client)</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="1234"
            placeholderTextColor={tokens.color.text.muted}
            keyboardType="number-pad"
            maxLength={4}
          />
          <BigButton
            label="Confirmer la livraison"
            onPress={() => void confirmDelivery()}
            loading={busy}
            disabled={code.length !== 4}
          />
        </View>
      )}

      {!failing ? (
        <BigButton label="Signaler un problème" variant="ghost" onPress={() => setFailing(true)} />
      ) : (
        <View style={styles.form}>
          <Text style={styles.cardLabel}>Motif</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={failReason}
            onChangeText={setFailReason}
            placeholder="Client injoignable, adresse introuvable…"
            placeholderTextColor={tokens.color.text.muted}
            multiline
          />
          <BigButton
            label="Confirmer l’échec"
            variant="danger"
            onPress={() => void submitFail()}
            loading={busy}
            disabled={failReason.trim().length === 0}
          />
          <BigButton label="Annuler" variant="ghost" onPress={() => setFailing(false)} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    textAlign: 'center',
    marginBottom: tokens.space['4'],
  },
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['5'],
    marginVertical: tokens.space['4'],
    gap: tokens.space['1'],
  },
  cardLabel: { fontSize: tokens.type.size.label, color: tokens.color.text.muted },
  cardTitle: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.text.primary },
  cardDetail: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  divider: {
    height: 1,
    backgroundColor: tokens.color.border.default,
    marginVertical: tokens.space['2'],
  },
  fee: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.brand.primary },
  form: { gap: tokens.space['3'], marginVertical: tokens.space['4'] },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: tokens.color.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space['4'],
    fontSize: tokens.type.size.h2,
    color: tokens.color.text.primary,
    backgroundColor: tokens.color.bg.surface,
  },
  textArea: {
    minHeight: 90,
    paddingTop: tokens.space['3'],
    fontSize: tokens.type.size.body,
    textAlignVertical: 'top',
  },
  errorBox: {
    backgroundColor: tokens.color.state.dangerBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['3'],
  },
  errorText: { color: tokens.color.state.danger, fontSize: tokens.type.size.body },
  doorHint: {
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.brand.primary,
    paddingLeft: tokens.space['3'],
    marginTop: tokens.space['2'],
  },
  doorHintLabel: { fontSize: tokens.type.size.label, color: tokens.color.text.muted },
  doorHintText: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  noteBox: { marginTop: tokens.space['2'], gap: tokens.space['2'] },
});
