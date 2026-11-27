import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  WHATSAPP_TEXT,
  notConfirmedActions,
  waitForWhatsapp,
  whatsappDesktopHint,
  whatsappSignedIn,
  whatsappWaitingText,
  whatsappWrongNumberText,
  type SignedIn,
  type WhatsappCode,
  type WhatsappOutcome,
} from '@djafat/sdk';
import { tokens } from '@djafat/tokens';
import { Button } from '../Button';
import { api } from '../../lib/api';
import { accountErrorMessage } from '../../lib/account';
import { accountStyles as s } from './styles';

interface WhatsappStepProps {
  /** A login (the warning shows) or the confirmation of the account's number. */
  readonly purpose: 'login' | 'confirm';
  /** Asks the API for a code to send: `startWhatsapp` or `startPhoneWhatsapp`. */
  readonly start: () => Promise<WhatsappCode>;
  /** Shown above the title (FEAT-023-VIS03: « ✅ Votre compte est créé. »). */
  readonly before?: ReactNode;
  /** Shown under the title. */
  readonly intro?: ReactNode;
  /** New device: « Se souvenir de cet appareil », sent with each question. */
  readonly remember?: { readonly checked: boolean; readonly onChange: (v: boolean) => void };
  readonly accountPhone?: string | null;
  readonly onSignedIn?: (signedIn: SignedIn) => void | Promise<void>;
  readonly onConfirmed?: () => void;
  readonly onCreateAccount?: (phone: string) => void;
  readonly onEmailLogin?: () => void;
  readonly backLabel?: string;
  readonly onBack: () => void;
}

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly outcome: WhatsappOutcome }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The free WhatsApp view in the customer app (FEAT-023-VIS02, VIS03;
 * SPEC-023-05 R8): « Ouvrir WhatsApp » opens WhatsApp with the message, and the
 * wait asks again as soon as the app is back in front. DJAFAT sends nothing.
 */
export function WhatsappStep(props: WhatsappStepProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const rememberRef = useRef(props.remember?.checked ?? false);
  rememberRef.current = props.remember?.checked ?? false;
  const handlers = useRef(props);
  handlers.current = props;

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    handlers.current
      .start()
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
      ask: () => api.auth.whatsappStatus({ token, rememberDevice: rememberRef.current }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') {
          void handlers.current.onSignedIn?.(whatsappSignedIn(outcome));
          return;
        }
        if (outcome.status === 'confirmed') {
          handlers.current.onConfirmed?.();
          return;
        }
        setShown({ kind: 'outcome', outcome });
      },
      onError: (err) =>
        setShown({ kind: 'error', message: accountErrorMessage(err, 'Connexion impossible.') }),
    });
    // R8: back from WhatsApp, ask at once.
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

  const back = (
    <Button
      label={props.backLabel ?? WHATSAPP_TEXT.otherWay}
      variant="ghost"
      fullWidth
      onPress={props.onBack}
    />
  );
  const newCode = <Button label={WHATSAPP_TEXT.newCode} fullWidth onPress={ask} />;

  return (
    <View style={s.form}>
      {props.before}
      <Text style={s.heading} accessibilityRole="header">
        {props.purpose === 'login' ? WHATSAPP_TEXT.loginTitle : WHATSAPP_TEXT.confirmTitle}
      </Text>
      {props.intro}

      {shown.kind === 'loading' ? <Text style={s.intro}>Préparation du code…</Text> : null}

      {shown.kind === 'error' ? (
        <>
          <View style={s.errorBox}>
            <Text style={s.errorText}>{shown.message}</Text>
          </View>
          {back}
        </>
      ) : null}

      {shown.kind === 'outcome' ? (
        <View style={s.form} accessibilityLiveRegion="polite">
          {shown.outcome.status === 'not_confirmed' ? (
            <>
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>{WHATSAPP_TEXT.notConfirmed}</Text>
              </View>
              {notConfirmedActions('customer').map((action) =>
                action === 'create_account' ? (
                  <Button
                    key={action}
                    label={WHATSAPP_TEXT.createAccount}
                    fullWidth
                    onPress={() => {
                      if (shown.outcome.status === 'not_confirmed') {
                        handlers.current.onCreateAccount?.(shown.outcome.phone);
                      }
                    }}
                  />
                ) : (
                  <Button
                    key={action}
                    label={WHATSAPP_TEXT.emailLogin}
                    variant="secondary"
                    fullWidth
                    onPress={() => handlers.current.onEmailLogin?.()}
                  />
                ),
              )}
            </>
          ) : null}
          {shown.outcome.status === 'expired' ? (
            <>
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>{WHATSAPP_TEXT.expired}</Text>
              </View>
              {newCode}
            </>
          ) : null}
          {shown.outcome.status === 'wrong_number' ? (
            <>
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  {whatsappWrongNumberText(props.accountPhone)}
                </Text>
              </View>
              {newCode}
            </>
          ) : null}
          {back}
        </View>
      ) : null}

      {shown.kind === 'code' ? (
        <>
          <Text style={s.label}>{WHATSAPP_TEXT.step1}</Text>
          <Text
            style={styles.message}
            accessibilityLabel={shown.code.text.replace(
              shown.code.code,
              shown.code.code.split('').join(' '),
            )}
          >
            « {shown.code.text} »
          </Text>
          <Text style={s.label}>
            {props.purpose === 'login' ? WHATSAPP_TEXT.step2 : WHATSAPP_TEXT.step2FromNumber}
          </Text>
          {props.purpose === 'login' ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>⚠️ {WHATSAPP_TEXT.warning}</Text>
            </View>
          ) : null}
          <Button
            label={`🟢 ${WHATSAPP_TEXT.open}`}
            fullWidth
            onPress={() => void Linking.openURL(shown.code.link)}
          />
          <Text style={s.intro}>{whatsappDesktopHint(shown.code.number)}</Text>
          {props.remember ? (
            <Pressable
              style={s.checkboxRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: props.remember.checked }}
              onPress={() => props.remember?.onChange(!props.remember.checked)}
            >
              <View style={[s.checkbox, props.remember.checked && s.checkboxOn]}>
                {props.remember.checked ? <Text style={s.checkboxMark}>✓</Text> : null}
              </View>
              <Text style={s.label}>Se souvenir de cet appareil</Text>
            </Pressable>
          ) : null}
          <Text style={s.intro} accessibilityLiveRegion="polite">
            {whatsappWaitingText(shown.code.expiresAt, now)}
          </Text>
          {back}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  warningBox: {
    backgroundColor: tokens.color.state.warningBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
  },
  warningText: { color: tokens.color.text.primary, fontSize: tokens.type.size.body },
});
