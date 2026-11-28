import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ApiClientError,
  WHATSAPP_TEXT,
  waitForWhatsapp,
  whatsappActionLabel,
  whatsappDesktopHint,
  whatsappOutcomeView,
  whatsappSignedIn,
  whatsappWaitingText,
  type SignedIn,
  type WhatsappAction,
  type WhatsappCode,
  type WhatsappOutcomeView,
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
  /** The number is confirmed — also when the server says it already was (409). */
  readonly onConfirmed?: () => void;
  /** FEAT-023-VIS03 « Ensuite »: say « Numéro confirmé » and wait for « Continuer ». */
  readonly confirmedContinue?: boolean;
  readonly onCreateAccount?: (phone: string) => void;
  readonly onEmailLogin?: () => void;
  readonly backLabel?: string;
  /** « Plus tard » of the sign-up step is a secondary button (SPEC-023-06 « UI »). */
  readonly backVariant?: 'ghost' | 'secondary';
  readonly onBack: () => void;
}

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly view: WhatsappOutcomeView; readonly phone?: string }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The free WhatsApp view in the customer app (FEAT-023-VIS02, VIS03;
 * SPEC-023-05 R8, R9): « Ouvrir WhatsApp » opens WhatsApp with the message, and
 * the wait asks again as soon as the app is back in front. The title takes
 * the focus; the wait and each outcome are announced on Android and iPhone.
 * DJAFAT sends nothing.
 */
export function WhatsappStep(props: WhatsappStepProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const title = useRef<Text>(null);
  const rememberRef = useRef(props.remember?.checked ?? false);
  rememberRef.current = props.remember?.checked ?? false;
  const handlers = useRef(props);
  handlers.current = props;

  const confirmed = useCallback(() => {
    if (handlers.current.confirmedContinue) setShown({ kind: 'confirmed' });
    else handlers.current.onConfirmed?.();
  }, []);

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    handlers.current
      .start()
      .then((code) => {
        setNow(Date.now()); // the validity counts from the code's arrival
        setShown({ kind: 'code', code });
      })
      .catch((err: unknown) => {
        // SPEC-023-06 « Erreurs »: already confirmed elsewhere.
        if (err instanceof ApiClientError && err.code === 'PHONE_ALREADY_CONFIRMED') {
          confirmed();
          return;
        }
        setShown({
          kind: 'error',
          message: accountErrorMessage(err, "WhatsApp n'est pas disponible pour le moment."),
        });
      });
  }, [confirmed]);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask();
  }, [ask]);
  // R9: the title takes the focus when the view opens.
  useEffect(() => {
    if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
  }, []);

  // R9: the wait and each outcome said aloud, on iPhone too.
  const said =
    shown.kind === 'code'
      ? WHATSAPP_TEXT.step2
      : shown.kind === 'outcome'
        ? shown.view.message
        : shown.kind === 'confirmed'
          ? WHATSAPP_TEXT.confirmed
          : shown.kind === 'error'
            ? shown.message
            : '';
  useEffect(() => {
    if (said) AccessibilityInfo.announceForAccessibility(said);
  }, [said]);

  const token = shown.kind === 'code' ? shown.code.token : null;
  useEffect(() => {
    if (!token) return;
    const wait = waitForWhatsapp({
      ask: () => api.auth.whatsappStatus({ token, rememberDevice: rememberRef.current }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') {
          void handlers.current.onSignedIn?.(whatsappSignedIn(outcome));
        } else if (outcome.status === 'confirmed') {
          confirmed();
        } else {
          const view = whatsappOutcomeView(outcome.status, {
            app: 'customer',
            accountPhone: handlers.current.accountPhone ?? null,
          });
          setShown(
            outcome.status === 'not_confirmed'
              ? { kind: 'outcome', view, phone: outcome.phone }
              : { kind: 'outcome', view },
          );
        }
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
  }, [token, confirmed]);

  function act(action: WhatsappAction) {
    if (action === 'new_code') ask();
    else if (action === 'email_login') handlers.current.onEmailLogin?.();
    else if (shown.kind === 'outcome' && shown.phone)
      handlers.current.onCreateAccount?.(shown.phone);
  }

  return (
    <View style={s.form}>
      {props.before}
      <Text ref={title} style={s.heading} accessibilityRole="header">
        {props.purpose === 'login' ? WHATSAPP_TEXT.loginTitle : WHATSAPP_TEXT.confirmTitle}
      </Text>
      {props.intro}

      {shown.kind === 'loading' ? <Text style={s.intro}>Préparation du code…</Text> : null}

      {shown.kind === 'error' ? (
        <View style={s.errorBox} accessibilityRole="alert">
          <Text style={s.errorText}>{shown.message}</Text>
        </View>
      ) : null}

      {shown.kind === 'outcome' ? (
        <>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>{shown.view.message}</Text>
          </View>
          {shown.view.actions.map((action, i) => (
            <Button
              key={action}
              label={whatsappActionLabel(action)}
              variant={i === 0 ? 'primary' : 'secondary'}
              fullWidth
              onPress={() => act(action)}
            />
          ))}
        </>
      ) : null}

      {shown.kind === 'confirmed' ? (
        <>
          <Text style={s.success}>{WHATSAPP_TEXT.confirmed}</Text>
          <Button
            label={WHATSAPP_TEXT.continue}
            fullWidth
            onPress={() => handlers.current.onConfirmed?.()}
          />
        </>
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
              <Text style={styles.warningText}>{WHATSAPP_TEXT.warning}</Text>
            </View>
          ) : null}
          <Button
            label={WHATSAPP_TEXT.open}
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
          <Text style={s.intro}>{whatsappWaitingText(shown.code.expiresAt, now)}</Text>
        </>
      ) : null}

      {shown.kind !== 'confirmed' ? (
        <Button
          label={props.backLabel ?? WHATSAPP_TEXT.otherWay}
          variant={props.backVariant ?? 'ghost'}
          fullWidth
          onPress={props.onBack}
        />
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
