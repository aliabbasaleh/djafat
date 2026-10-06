import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { ApiClientError, type Address } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/(app)/addresses` — address book (Bloc 12, docs/29). Manual
 * quartier/street/landmark entry only, no map picker — matches the
 * "landmark-first" fallback docs/09 B.1 already documents for N'Djamena
 * addressing (no GPS/map dependency added for this vertical slice).
 */
export default function AddressesScreen() {
  const router = useRouter();
  const { state: authState } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [quartier, setQuartier] = useState('');
  const [street, setStreet] = useState('');
  const [landmark, setLandmark] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setAddresses(await api.addresses.list());
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push('/(auth)/login?redirect=%2F(app)%2Faddresses' as `/${string}`);
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    if (authState === 'signed-out') {
      router.replace('/(auth)/login?redirect=%2F(app)%2Faddresses' as `/${string}`);
      return;
    }
    if (authState === 'signed-in') void load();
  }, [authState, load, router]);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await api.addresses.create({
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(quartier.trim() ? { quartier: quartier.trim() } : {}),
        ...(street.trim() ? { street: street.trim() } : {}),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
        ...(recipientPhone.trim() ? { recipientPhone: recipientPhone.trim() } : {}),
      });
      setLabel('');
      setQuartier('');
      setStreet('');
      setLandmark('');
      setRecipientPhone('');
      setShowForm(false);
      await load();
    } catch {
      setError("Impossible d'enregistrer cette adresse.");
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(id: string) {
    await api.addresses.setDefault(id);
    await load();
  }

  async function remove(id: string) {
    await api.addresses.remove(id);
    await load();
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
        <Text style={styles.subtle}>Impossible de charger vos adresses.</Text>
        <Button label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Mes adresses</Text>

      {addresses.length === 0 && <Text style={styles.subtle}>Aucune adresse enregistrée.</Text>}

      {addresses.map((address) => (
        <View key={address.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardLabel}>{address.label ?? 'Sans nom'}</Text>
            {address.isDefault && <Text style={styles.defaultBadge}>Par défaut</Text>}
          </View>
          <Text style={styles.cardDetail}>
            {[address.quartier, address.street, address.landmark].filter(Boolean).join(', ') ||
              'Adresse sans détail'}
          </Text>
          <View style={styles.cardActions}>
            {!address.isDefault && (
              <Pressable onPress={() => void setDefault(address.id)}>
                <Text style={styles.actionLink}>Définir par défaut</Text>
              </Pressable>
            )}
            <Pressable onPress={() => void remove(address.id)}>
              <Text style={styles.actionLinkDanger}>Supprimer</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {!showForm ? (
        <Button
          label="+ Ajouter une adresse"
          variant="secondary"
          fullWidth
          onPress={() => setShowForm(true)}
        />
      ) : (
        <View style={styles.form}>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="Nom (ex. Maison)"
            placeholderTextColor={tokens.color.text.muted}
          />
          <TextInput
            style={styles.input}
            value={quartier}
            onChangeText={setQuartier}
            placeholder="Quartier"
            placeholderTextColor={tokens.color.text.muted}
          />
          <TextInput
            style={styles.input}
            value={street}
            onChangeText={setStreet}
            placeholder="Rue"
            placeholderTextColor={tokens.color.text.muted}
          />
          <TextInput
            style={styles.input}
            value={landmark}
            onChangeText={setLandmark}
            placeholder="Repère (ex. près de la pharmacie)"
            placeholderTextColor={tokens.color.text.muted}
          />
          <TextInput
            style={styles.input}
            value={recipientPhone}
            onChangeText={setRecipientPhone}
            placeholder="Téléphone du destinataire"
            placeholderTextColor={tokens.color.text.muted}
            keyboardType="phone-pad"
          />
          <Button label="Enregistrer" fullWidth loading={saving} onPress={() => void submit()} />
          <Button label="Annuler" variant="ghost" fullWidth onPress={() => setShowForm(false)} />
        </View>
      )}
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
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['3'],
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: tokens.type.size.h3, fontWeight: '600', color: tokens.color.text.primary },
  defaultBadge: {
    fontSize: tokens.type.size.caption,
    color: tokens.color.state.success,
    fontWeight: '600',
  },
  cardDetail: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['1'],
  },
  cardActions: { flexDirection: 'row', gap: tokens.space['4'], marginTop: tokens.space['2'] },
  actionLink: { fontSize: tokens.type.size.small, color: tokens.color.brand.primary },
  actionLinkDanger: { fontSize: tokens.type.size.small, color: tokens.color.state.danger },
  form: { gap: tokens.space['3'], marginTop: tokens.space['2'] },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: tokens.color.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space['4'],
    fontSize: tokens.type.size.body,
    color: tokens.color.text.primary,
    backgroundColor: tokens.color.bg.surface,
  },
  errorText: { fontSize: tokens.type.size.body, color: tokens.color.state.danger },
});
