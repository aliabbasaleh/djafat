import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
import { tokens } from '@djafat/tokens';
import {
  ApiClientError,
  MOBILE_MONEY_CHOICES,
  mobileMoneyErrors,
  mobileMoneyText,
  pendingChangeOf,
  phoneForField,
  phoneForSending,
  type CourierApplication,
  type MobileMoney,
} from '@djafat/sdk';
import { api } from '../lib/api';
import { BigButton } from './BigButton';
import { PhoneInput } from './PhoneInput';

/**
 * FEAT-022 (SPEC-022-07 R6, SC05): where a validated courier's earnings go,
 * and « Changer de numéro ». A new number waits for DJAFAT; until an admin
 * accepts it, the earnings keep going to the approved one, and the courier
 * keeps working (« En ligne » never stops). Shown only once validated — a
 * courier created by the team has no application and sees nothing here.
 */
export function MobileMoneyCard() {
  const [application, setApplication] = useState<CourierApplication | null>(null);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<MobileMoney['provider'] | ''>('');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<{ field: 'provider' | 'number' | null; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const numberRef = useRef<TextInput>(null);

  useEffect(() => {
    let stop = false;
    void api.courier.application
      .get()
      .then((a) => {
        if (!stop) setApplication(a);
      })
      .catch(() => {
        /* no application (created by the team) or offline: nothing to show */
      });
    return () => {
      stop = true;
    };
  }, []);

  if (!application || application.status !== 'approved' || !application.mobileMoney) return null;
  const approved = application.mobileMoney;
  const waiting = pendingChangeOf(application, 'mobile_money');

  /** The form starts from the number that will apply: the one waiting, else the approved one (R6). */
  const startFrom = waiting?.mobileMoney ?? approved;

  function start() {
    setMessage(null);
    setError(null);
    setProvider(startFrom.provider);
    setNumber(phoneForField(startFrom.number));
    setEditing(true);
  }

  async function send() {
    if (
      provider === startFrom.provider &&
      phoneForSending(number) === phoneForSending(phoneForField(startFrom.number))
    ) {
      setEditing(false);
      setMessage('Rien n’a changé.');
      return;
    }
    const found = mobileMoneyErrors({ provider, number });
    if (found.provider) {
      setError({ field: 'provider', text: found.provider });
      return;
    }
    if (found.number) {
      setError({ field: 'number', text: found.number });
      numberRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api.courier.application.update({
        mobileMoney: { provider: provider as MobileMoney['provider'], number },
      });
      setApplication(next);
      setEditing(false);
      setMessage(
        pendingChangeOf(next, 'mobile_money')
          ? 'Nouveau numéro envoyé : DJAFAT le vérifie. Vos gains continuent vers le numéro actuel jusque-là.'
          : 'Vous gardez votre numéro actuel.',
      );
    } catch (err) {
      setError({
        field: null,
        text: err instanceof ApiClientError ? err.message : 'Envoi impossible pour le moment.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Numéro Mobile Money</Text>
      <Text style={styles.text}>Vos gains sont envoyés sur : {mobileMoneyText(approved)}</Text>
      {waiting?.mobileMoney && (
        <Text style={styles.waiting}>
          ⏳ Nouveau numéro en attente de DJAFAT : {mobileMoneyText(waiting.mobileMoney)}
        </Text>
      )}
      {message && (
        <Text style={styles.text} accessibilityLiveRegion="polite" aria-live="polite">
          {message}
        </Text>
      )}
      {!editing ? (
        <BigButton
          label={waiting ? 'Changer encore de numéro' : 'Changer de numéro'}
          variant="ghost"
          onPress={start}
        />
      ) : (
        <View style={styles.form}>
          <View
            style={styles.choices}
            accessibilityRole="radiogroup"
            accessibilityLabel="Opérateur Mobile Money"
          >
            {MOBILE_MONEY_CHOICES.map((choice) => (
              <Pressable
                key={choice.value}
                accessibilityRole="radio"
                aria-checked={provider === choice.value}
                onPress={() => {
                  setProvider(choice.value);
                  setError(null);
                }}
                style={[styles.choice, provider === choice.value ? styles.choiceSelected : null]}
              >
                <Text
                  style={[
                    styles.choiceLabel,
                    provider === choice.value ? styles.choiceLabelSelected : null,
                  ]}
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {error?.field === 'provider' && (
            <Text style={styles.error} accessibilityRole="alert">
              {error.text}
            </Text>
          )}
          {/* FEAT-024 (SPEC-024-02 R4): a Chad mobile only — « +235 » always shows. */}
          <PhoneInput
            label="Nouveau numéro Mobile Money"
            use="mobile_money"
            inputStyle={styles.input}
            inputRef={numberRef}
            error={error?.field === 'number' ? error.text : null}
            value={number}
            onChangeText={(text) => {
              setNumber(text);
              setError(null);
            }}
            placeholder="66 12 34 56"
          />
          {error?.field === null && (
            <Text style={styles.error} accessibilityRole="alert">
              {error.text}
            </Text>
          )}
          <Text style={styles.note}>
            DJAFAT vérifie le nouveau numéro avant d’y envoyer vos gains ; vous continuez à
            travailler normalement.
          </Text>
          <BigButton label="Envoyer à DJAFAT" loading={busy} onPress={() => void send()} />
          <BigButton label="Annuler" variant="ghost" onPress={() => setEditing(false)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['5'],
    marginBottom: tokens.space['3'],
    gap: tokens.space['2'],
  },
  title: { fontSize: tokens.type.size.body, fontWeight: '700', color: tokens.color.text.primary },
  text: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  waiting: { fontSize: tokens.type.size.body, color: tokens.color.text.primary },
  note: { fontSize: tokens.type.size.label, color: tokens.color.text.secondary },
  error: { fontSize: tokens.type.size.label, color: tokens.color.state.danger },
  form: { gap: tokens.space['2'] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] },
  choice: {
    minHeight: 48,
    paddingHorizontal: tokens.space['4'],
    justifyContent: 'center',
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.strong,
    backgroundColor: tokens.color.bg.surface,
  },
  choiceSelected: {
    backgroundColor: tokens.color.brand.primary,
    borderColor: tokens.color.brand.primary,
  },
  choiceLabel: {
    fontSize: tokens.type.size.body,
    fontWeight: '600',
    color: tokens.color.text.primary,
  },
  choiceLabelSelected: { color: tokens.color.brand.onPrimary },
  input: {
    minHeight: 48,
    paddingHorizontal: tokens.space['3'],
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.strong,
    backgroundColor: tokens.color.bg.surface,
    color: tokens.color.text.primary,
    fontSize: tokens.type.size.body,
  },
});
