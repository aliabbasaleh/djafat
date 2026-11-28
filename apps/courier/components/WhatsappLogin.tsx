import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {
  WHATSAPP_ICON,
  WHATSAPP_TEXT,
  accountErrorMessage,
  waitForWhatsapp,
  whatsappActionLabel,
  whatsappDesktopHint,
  whatsappOutcomeView,
  whatsappWaitingText,
  type SignedIn,
  type WhatsappAction,
  type WhatsappCode,
  type WhatsappOutcomeView,
} from '@djafat/sdk';
import { tokens } from '@djafat/tokens';
import { api } from '../lib/api';
import { BigButton } from './BigButton';

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly view: WhatsappOutcomeView }
  | { readonly kind: 'error'; readonly message: string };

interface WhatsappLoginProps {
  /** The session the wait ended with — the screen passes it through `teamWhatsappSignIn`. */
  readonly onSignedIn: (answer: { readonly status: 'signed_in' } & SignedIn) => void;
  readonly onEmailLogin: () => void;
  readonly onBack: () => void;
}

/** A picture in front of a text, never read aloud (SPEC-023-05 R9). */
function Picture({ icon, style }: { readonly icon: string; readonly style: StyleProp<TextStyle> }) {
  return (
    <View aria-hidden>
      <Text style={style}>{icon}</Text>
    </View>
  );
}

/**
 * WhatsApp in the courier app's login (FEAT-023, SPEC-023-07 R1, R6): the
 * message to send, « Ouvrir WhatsApp » (the WhatsApp app), the wait — asked
 * again as soon as the app is back in front — then the courier role check.
 * The title takes the focus; the wait and each outcome are said aloud, on a
 * phone and in a browser (the courier app's production form, react-native-web).
 */
export function WhatsappLogin(props: WhatsappLoginProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const title = useRef<Text>(null);
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
  // The title takes the focus when the view opens. react-native-web has no
  // `sendAccessibilityEvent`: in a browser the title is a DOM element, focused by script.
  useEffect(() => {
    const node = title.current;
    if (!node) return;
    if (Platform.OS === 'web') {
      const element = node as unknown as {
        setAttribute(name: string, value: string): void;
        focus(): void;
      };
      element.setAttribute('tabindex', '-1');
      element.focus();
    } else {
      AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }
  }, []);

  // The one live region: the wait, then the outcome, in the same place. The
  // browser (aria-live) and Android read its changes; an iPhone has no live
  // regions, so the same text is announced there. An error has the alert role,
  // which the browser reads by itself.
  const status =
    shown.kind === 'loading'
      ? 'Préparation du code…'
      : shown.kind === 'code'
        ? whatsappWaitingText(shown.code.expiresAt, now)
        : shown.kind === 'outcome'
          ? shown.view.message
          : '';
  const announced =
    shown.kind === 'error'
      ? Platform.OS === 'web'
        ? ''
        : shown.message
      : Platform.OS === 'ios' && shown.kind !== 'loading'
        ? status
        : '';
  useEffect(() => {
    if (announced) AccessibilityInfo.announceForAccessibility(announced);
  }, [announced]);

  const token = shown.kind === 'code' ? shown.code.token : null;
  useEffect(() => {
    if (!token) return;
    const wait = waitForWhatsapp({
      ask: () => api.auth.whatsappStatus({ token }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') {
          handlers.current.onSignedIn(outcome);
        } else if (outcome.status !== 'confirmed') {
          setShown({ kind: 'outcome', view: whatsappOutcomeView(outcome.status, { app: 'team' }) });
        }
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

  function act(action: WhatsappAction) {
    if (action === 'new_code') ask();
    else handlers.current.onEmailLogin();
  }

  const back = <BigButton label={WHATSAPP_TEXT.otherWay} variant="ghost" onPress={props.onBack} />;

  return (
    <View style={styles.form}>
      <Text ref={title} style={styles.title} accessibilityRole="header">
        {WHATSAPP_TEXT.loginTitle}
      </Text>
      {shown.kind === 'error' ? (
        <Text style={styles.error} accessibilityRole="alert">
          {shown.message}
        </Text>
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
          <View style={[styles.line, styles.box]}>
            <Picture icon={WHATSAPP_ICON.warning} style={styles.boxText} />
            <Text style={[styles.boxText, styles.lineText]}>{WHATSAPP_TEXT.warning}</Text>
          </View>
          <BigButton
            label={WHATSAPP_TEXT.open}
            onPress={() => void Linking.openURL(shown.code.link)}
          />
          <Text style={styles.hint}>{whatsappDesktopHint(shown.code.number)}</Text>
        </>
      ) : null}
      {shown.kind !== 'error' ? (
        <View aria-live="polite" style={[styles.line, shown.kind === 'outcome' && styles.box]}>
          {shown.kind === 'code' || shown.kind === 'outcome' ? (
            <Picture
              icon={shown.kind === 'code' ? WHATSAPP_ICON.waiting : WHATSAPP_ICON.warning}
              style={shown.kind === 'outcome' ? styles.boxText : styles.hint}
            />
          ) : null}
          <Text style={[shown.kind === 'outcome' ? styles.boxText : styles.hint, styles.lineText]}>
            {status}
          </Text>
        </View>
      ) : null}
      {shown.kind === 'outcome'
        ? shown.view.actions.map((action) => (
            <BigButton
              key={action}
              label={whatsappActionLabel(action)}
              onPress={() => act(action)}
            />
          ))
        : null}
      {back}
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
  line: { flexDirection: 'row', gap: tokens.space['2'] },
  lineText: { flexShrink: 1 },
  box: {
    padding: tokens.space['3'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.state.warningBg,
  },
  boxText: { color: tokens.color.text.primary, fontSize: tokens.type.size.body },
  hint: { fontSize: tokens.type.size.caption, color: tokens.color.text.secondary },
  error: {
    padding: tokens.space['3'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.state.dangerBg,
    color: tokens.color.state.danger,
    fontSize: tokens.type.size.body,
  },
});
