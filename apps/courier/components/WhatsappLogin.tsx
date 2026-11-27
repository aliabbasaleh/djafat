import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import {
  WHATSAPP_TEXT,
  accountErrorMessage,
  notConfirmedActions,
  waitForWhatsapp,
  whatsappDesktopHint,
  whatsappWaitingText,
  type SignedIn,
  type WhatsappCode,
  type WhatsappOutcome,
} from '@djafat/sdk';
import { tokens } from '@djafat/tokens';
import { api } from '../lib/api';
import { BigButton } from './BigButton';

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly outcome: WhatsappOutcome }
  | { readonly kind: 'error'; readonly message: string };

interface WhatsappLoginProps {
  /** The session the wait ended with — the screen passes it through `teamWhatsappSignIn`. */
  readonly onSignedIn: (answer: { readonly status: 'signed_in' } & SignedIn) => void;
  readonly onEmailLogin: () => void;
  readonly onBack: () => void;
}

/**
 * WhatsApp in the courier app's login (FEAT-023, SPEC-023-07 R1, R6): the
 * message to send, « Ouvrir WhatsApp » (the WhatsApp app), the wait — asked
 * again as soon as the app is back in front — then the courier role check.
 */
export function WhatsappLogin(props: WhatsappLoginProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const handlers = useRef(props);
  handlers.current = props;

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    api.auth
      .startWhatsapp()
      .then((code) => {
        setNow(Date.now()); // the validity counts from the code's arrival
        setShown({ kind: 'code', code });
      })
      .catch((err: unknown) =>
        setShown({
          kind: 'error',
          message: accountErrorMessage(err, "WhatsApp n'est pas disponible pour le moment."),
        }),
      );
  }, []);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask();
  }, [ask]);

  const token = shown.kind === 'code' ? shown.code.token : null;
  useEffect(() => {
    if (!token) return;
    const wait = waitForWhatsapp({
      ask: () => api.auth.whatsappStatus({ token }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') handlers.current.onSignedIn(outcome);
        else setShown({ kind: 'outcome', outcome });
      },
      onError: (err) =>
        setShown({ kind: 'error', message: accountErrorMessage(err, 'Connexion impossible.') }),
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') wait.poke();
    });
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      wait.stop();
      subscription.remove();
      clearInterval(clock);
    };
  }, [token]);

  const back = <BigButton label={WHATSAPP_TEXT.otherWay} variant="ghost" onPress={props.onBack} />;

  return (
    <View style={styles.form}>
      <Text style={styles.title} accessibilityRole="header">
        {WHATSAPP_TEXT.loginTitle}
      </Text>
      {shown.kind === 'loading' ? <Text style={styles.hint}>Préparation du code…</Text> : null}
      {shown.kind === 'error' ? (
        <>
          <Text style={styles.error}>{shown.message}</Text>
          {back}
        </>
      ) : null}
      {shown.kind === 'outcome' ? (
        <View style={styles.form} accessibilityLiveRegion="polite">
          {shown.outcome.status === 'not_confirmed' ? (
            <>
              <Text style={styles.warning}>{WHATSAPP_TEXT.notConfirmed}</Text>
              {notConfirmedActions('team').map((action) => (
                <BigButton
                  key={action}
                  label={WHATSAPP_TEXT.emailLogin}
                  onPress={() => handlers.current.onEmailLogin()}
                />
              ))}
            </>
          ) : (
            <>
              <Text style={styles.warning}>{WHATSAPP_TEXT.expired}</Text>
              <BigButton label={WHATSAPP_TEXT.newCode} onPress={ask} />
            </>
          )}
          {back}
        </View>
      ) : null}
      {shown.kind === 'code' ? (
        <>
          <Text style={styles.label}>{WHATSAPP_TEXT.step1}</Text>
          <Text
            style={styles.message}
            accessibilityLabel={shown.code.text.replace(
              shown.code.code,
              shown.code.code.split('').join(' '),
            )}
          >
            « {shown.code.text} »
          </Text>
          <Text style={styles.label}>{WHATSAPP_TEXT.step2}</Text>
          <Text style={styles.warning}>⚠️ {WHATSAPP_TEXT.warning}</Text>
          <BigButton
            label={`🟢 ${WHATSAPP_TEXT.open}`}
            onPress={() => void Linking.openURL(shown.code.link)}
          />
          <Text style={styles.hint}>{whatsappDesktopHint(shown.code.number)}</Text>
          <Text style={styles.hint} accessibilityLiveRegion="polite">
            {whatsappWaitingText(shown.code.expiresAt, now)}
          </Text>
          {back}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: tokens.space['4'] },
  title: { fontSize: tokens.type.size.h2, fontWeight: '700', color: tokens.color.text.primary },
  label: { fontSize: tokens.type.size.label, fontWeight: '600', color: tokens.color.text.primary },
  message: {
    padding: tokens.space['3'],
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.brand.primary,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surfaceAlt,
    color: tokens.color.text.primary,
    fontSize: tokens.type.size.body,
    fontWeight: '700',
  },
  warning: {
    padding: tokens.space['3'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.state.warningBg,
    color: tokens.color.text.primary,
    fontSize: tokens.type.size.body,
  },
  hint: { fontSize: tokens.type.size.caption, color: tokens.color.text.secondary },
  error: {
    padding: tokens.space['3'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.state.dangerBg,
    color: tokens.color.state.danger,
    fontSize: tokens.type.size.body,
  },
});
