import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  RESEND_COOLDOWN_SECONDS,
  accountErrorMessage,
  emailTypoCheck,
  phoneCodeButtons,
  smsPhoneError,
  teamPasswordLogin,
  teamResetPassword,
  teamVerifyCode,
  teamVerifyPhoneCode,
  type ChannelButton,
} from '@djafat/sdk';
import { tokens } from '@djafat/tokens';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { EmailSuggestion } from '../../components/EmailSuggestion';
import { PhoneInput } from '../../components/PhoneInput';
import { COURIER_SIGNUP_URL, api } from '../../lib/api';
import { courierSessionKeeper, loadDeviceToken } from '../../lib/auth-storage';
import { useAuth } from '../../lib/auth-context';

type PhoneChannel = 'sms' | 'whatsapp';
type Step =
  | { readonly kind: 'password' }
  | { readonly kind: 'code'; readonly challengeId: string; readonly destination: string }
  | { readonly kind: 'forgot' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'phone'; readonly channel: PhoneChannel }
  | { readonly kind: 'phone-code'; readonly channel: PhoneChannel };

const HOME = '/(app)/home';
const FALLBACK = 'Connexion impossible pour le moment.';

/**
 * Courier login (Bloc 11, docs/04 §4.7; FEAT-021, SPEC-021-04): e-mail and
 * password with the FEAT-020 rules — a code by e-mail on a device this app
 * does not remember, « Mot de passe oublié ? » — and the phone code only when
 * the server offers SMS or WhatsApp (SPEC-021-02 R5). An account without the
 * `courier` role is refused HERE and nothing is kept: every `/couriers/me/*`
 * call would fail anyway.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const keeper = useMemo(() => courierSessionKeeper(signIn), [signIn]);
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string | undefined;
    confirm?: string | undefined;
  }>({});
  const [phone, setPhone] = useState('');
  const [phoneButtons, setPhoneButtons] = useState<ChannelButton[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auth.methods().then(
      (res) => {
        if (!cancelled) setPhoneButtons(phoneCodeButtons(res.methods));
      },
      () => {
        if (!cancelled) setPhoneButtons(phoneCodeButtons(null));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function go(next: Step, message: string | null = null) {
    setError(null);
    setNotice(message);
    setCode('');
    setFieldErrors({});
    setStep(next);
  }

  /** R2: an error disappears as soon as a field changes. */
  function typed(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setError(null);
    };
  }

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

  /** SPEC-024-04 R3, R4: true when the sending stops once to suggest a fixed address. */
  function stopForTypo(): boolean {
    const typo = emailTypoCheck(email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    return typo.suggestion !== null;
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(accountErrorMessage(err, FALLBACK));
    } finally {
      setLoading(false);
    }
  }

  function finish(outcome: 'signed_in' | 'denied') {
    if (outcome === 'signed_in') router.replace(HOME);
    else setError(keeper.deniedMessage);
  }

  function login() {
    if (stopForTypo()) return;
    void run(async () => {
      const next = await teamPasswordLogin(
        api.auth,
        { email, password, deviceToken: await loadDeviceToken() },
        keeper,
      );
      if (next.kind === 'code') {
        setCooldown(RESEND_COOLDOWN_SECONDS);
        go({ kind: 'code', challengeId: next.challengeId, destination: next.destination });
      } else {
        finish(next.kind);
      }
    });
  }

  function verify(challengeId: string) {
    void run(async () => {
      finish(
        await teamVerifyCode(api.auth, { challengeId, code, rememberDevice: remember }, keeper),
      );
    });
  }

  function resendLoginCode(challengeId: string) {
    void run(async () => {
      await api.auth.sendLoginCode(challengeId, 'email');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('Un nouveau code vient de partir.');
    });
  }

  function askResetCode() {
    if (stopForTypo()) return;
    void run(async () => {
      await api.auth.forgotPassword(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      go(
        { kind: 'reset' },
        'Si un compte DJAFAT utilise cette adresse, un code vient d’y être envoyé.',
      );
    });
  }

  function reset() {
    void run(async () => {
      const result = await teamResetPassword(
        api.auth,
        { email, code, password: newPassword, confirm },
        keeper,
      );
      if (result.kind === 'invalid') {
        setFieldErrors(result.errors);
        return;
      }
      setFieldErrors({});
      finish(result.kind);
    });
  }

  function choosePhone(button: ChannelButton) {
    if (!button.enabled) return;
    if (button.id === 'whatsapp') {
      if (button.link) void Linking.openURL(button.link);
      go({ kind: 'phone-code', channel: 'whatsapp' });
    } else {
      go({ kind: 'phone', channel: 'sms' });
    }
  }

  function requestSmsCode() {
    // FEAT-024 (SPEC-024-01 R8): no SMS to a foreign number or a fixed line — nothing is sent.
    const whatsapp = phoneButtons.some((b) => b.id === 'whatsapp' && b.enabled);
    const why = smsPhoneError(phone, whatsapp);
    if (why) {
      setError(why);
      return;
    }
    void run(async () => {
      await api.auth.requestPhoneLoginCode(phone);
      go({ kind: 'phone-code', channel: 'sms' });
    });
  }

  function verifyPhoneCode(channel: PhoneChannel) {
    void run(async () => {
      finish(await teamVerifyPhoneCode(api.auth, { channel, phone, code }, keeper));
    });
  }

  const subtitle =
    step.kind === 'code'
      ? `Code envoyé à ${step.destination}.`
      : step.kind === 'forgot'
        ? 'Recevez un code par e-mail pour choisir un nouveau mot de passe.'
        : step.kind === 'reset'
          ? `Saisissez le code reçu à ${email} et votre nouveau mot de passe.`
          : step.kind === 'phone-code'
            ? step.channel === 'whatsapp'
              ? 'Envoyez « Code DJAFAT » sur WhatsApp, puis saisissez le code reçu.'
              : `Code envoyé au ${phone}.`
            : 'Connexion livreur.';

  const back = (
    <BigButton label="Retour" variant="ghost" onPress={() => go({ kind: 'password' })} />
  );
  const codeInput = (autoFocus = true) => (
    <>
      <Text style={styles.label}>Code à 6 chiffres</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(v) => typed(setCode)(digits(v))}
        placeholder="123456"
        placeholderTextColor={tokens.color.text.muted}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        accessibilityLabel="Code à 6 chiffres"
        autoFocus={autoFocus}
      />
    </>
  );
  const emailInput = (
    <>
      <Text style={styles.label}>E-mail</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={(value) => {
          typed(setEmail)(value);
          setEmailHint(null);
        }}
        placeholder="vous@gmail.com"
        placeholderTextColor={tokens.color.text.muted}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="E-mail"
        autoFocus
      />
      <EmailSuggestion
        suggestion={emailHint}
        onAccept={(address) => {
          setEmail(address);
          setEmailHint(null);
        }}
      />
    </>
  );
  const phoneInput = (autoFocus = false) => (
    <>
      <Text style={styles.label}>Numéro de téléphone</Text>
      <PhoneInput
        label="Numéro de téléphone"
        inputStyle={styles.input}
        value={phone}
        onChangeText={typed(setPhone)}
        placeholder="66 12 34 56"
        autoFocus={autoFocus}
      />
    </>
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>DJAFAT Livreur</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {notice && !error && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}
      {error && (
        <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {step.kind === 'password' && (
        <View style={styles.form}>
          {emailInput}
          <View style={styles.labelRow}>
            <Text style={styles.label}>Mot de passe</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showPassword ? 'Masquer : Mot de passe' : 'Afficher : Mot de passe'
              }
              hitSlop={8}
              onPress={() => setShowPassword((v) => !v)}
            >
              <Text style={styles.toggle}>👁 {showPassword ? 'Masquer' : 'Afficher'}</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={typed(setPassword)}
            secureTextEntry={!showPassword}
            textContentType="password"
            autoComplete="password"
            autoCapitalize="none"
            accessibilityLabel="Mot de passe"
          />
          <BigButton label="Se connecter" onPress={login} loading={loading} />
          <BigButton
            label="Mot de passe oublié ?"
            variant="ghost"
            onPress={() => go({ kind: 'forgot' })}
          />
          {phoneButtons.length > 0 && (
            <View style={styles.phoneCodes}>
              <Text style={styles.divider}>ou recevoir un code par téléphone</Text>
              <View style={styles.channels}>
                {phoneButtons.map((button) => (
                  <Pressable
                    key={button.id}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !button.enabled }}
                    accessibilityLabel={
                      button.note ? `${button.label}, ${button.note}` : button.label
                    }
                    disabled={!button.enabled}
                    onPress={() => choosePhone(button)}
                    style={[styles.channel, !button.enabled && styles.channelDisabled]}
                  >
                    <Text style={[styles.channelText, !button.enabled && styles.textDisabled]}>
                      {button.label}
                    </Text>
                    {button.note && (
                      <Text style={[styles.channelNote, styles.textDisabled]}>{button.note}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {/* FEAT-022 (SPEC-022-01 R6): the same sign-up everywhere — the site's courier form. */}
          {COURIER_SIGNUP_URL ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Pas encore de compte ? Devenir livreur"
              onPress={() => {
                if (COURIER_SIGNUP_URL) void Linking.openURL(COURIER_SIGNUP_URL);
              }}
              style={styles.signup}
            >
              <Text style={styles.signupText}>
                Pas encore de compte ? <Text style={styles.signupLink}>Devenir livreur</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {step.kind === 'code' && (
        <View style={styles.form}>
          {codeInput()}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Se souvenir de cet appareil (30 jours)</Text>
            <Switch
              value={remember}
              onValueChange={setRemember}
              accessibilityLabel="Se souvenir de cet appareil (30 jours)"
            />
          </View>
          <BigButton label="Vérifier" onPress={() => verify(step.challengeId)} loading={loading} />
          <BigButton
            label={cooldown > 0 ? `Renvoyer le code (dans ${cooldown} s)` : 'Renvoyer le code'}
            variant="ghost"
            disabled={cooldown > 0 || loading}
            onPress={() => resendLoginCode(step.challengeId)}
          />
          {back}
        </View>
      )}

      {step.kind === 'forgot' && (
        <View style={styles.form}>
          {emailInput}
          <BigButton label="Recevoir un code" onPress={askResetCode} loading={loading} />
          {back}
        </View>
      )}

      {step.kind === 'reset' && (
        <View style={styles.form}>
          {codeInput()}
          <Text style={styles.label}>Nouveau mot de passe</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={(v) => {
              typed(setNewPassword)(v);
              setFieldErrors((f) => ({ ...f, password: undefined }));
            }}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="password-new"
            autoCapitalize="none"
            accessibilityLabel="Nouveau mot de passe"
          />
          <Text
            style={fieldErrors.password ? styles.fieldError : styles.hint}
            {...(fieldErrors.password
              ? { accessibilityRole: 'alert' as const, accessibilityLiveRegion: 'polite' as const }
              : {})}
          >
            {fieldErrors.password ?? 'Au moins 8 caractères.'}
          </Text>
          <Text style={styles.label}>Confirmer le mot de passe</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={(v) => {
              typed(setConfirm)(v);
              setFieldErrors((f) => ({ ...f, confirm: undefined }));
            }}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="password-new"
            autoCapitalize="none"
            accessibilityLabel="Confirmer le mot de passe"
          />
          {fieldErrors.confirm && (
            <Text
              style={styles.fieldError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {fieldErrors.confirm}
            </Text>
          )}
          <BigButton label="Changer le mot de passe" onPress={reset} loading={loading} />
          <BigButton
            label={cooldown > 0 ? `Renvoyer le code (dans ${cooldown} s)` : 'Renvoyer le code'}
            variant="ghost"
            disabled={cooldown > 0 || loading}
            onPress={askResetCode}
          />
          {back}
        </View>
      )}

      {step.kind === 'phone' && (
        <View style={styles.form}>
          {phoneInput(true)}
          <BigButton label="Envoyer le code" onPress={requestSmsCode} loading={loading} />
          {back}
        </View>
      )}

      {step.kind === 'phone-code' && (
        <View style={styles.form}>
          {step.channel === 'whatsapp' && phoneInput(true)}
          {codeInput(step.channel !== 'whatsapp')}
          <BigButton
            label="Vérifier"
            onPress={() => verifyPhoneCode(step.channel)}
            loading={loading}
          />
          {back}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: tokens.space['10'], marginBottom: tokens.space['6'] },
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  subtitle: {
    marginTop: tokens.space['2'],
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
  },
  form: { gap: tokens.space['4'] },
  label: { fontSize: tokens.type.size.label, fontWeight: '600', color: tokens.color.text.primary },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggle: {
    fontSize: tokens.type.size.label,
    fontWeight: '600',
    color: tokens.color.brand.primary,
  },
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
  hint: { fontSize: tokens.type.size.caption, color: tokens.color.text.secondary },
  fieldError: { fontSize: tokens.type.size.caption, color: tokens.color.state.danger },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space['3'],
  },
  switchLabel: { flex: 1, fontSize: tokens.type.size.body, color: tokens.color.text.primary },
  phoneCodes: { gap: tokens.space['2'] },
  divider: {
    textAlign: 'center',
    fontSize: tokens.type.size.caption,
    color: tokens.color.text.secondary,
  },
  channels: { flexDirection: 'row', gap: tokens.space['2'] },
  channel: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: tokens.space['2'],
    borderWidth: 2,
    borderColor: tokens.color.border.default,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.surface,
  },
  channelDisabled: { backgroundColor: tokens.color.bg.surfaceAlt },
  channelText: {
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  channelNote: { fontSize: 11, fontWeight: '600' },
  textDisabled: { color: tokens.color.text.disabled },
  noticeBox: {
    backgroundColor: tokens.color.state.infoBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['4'],
  },
  noticeText: { color: tokens.color.state.info, fontSize: tokens.type.size.body },
  errorBox: {
    backgroundColor: tokens.color.state.dangerBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['4'],
  },
  errorText: { color: tokens.color.state.danger, fontSize: tokens.type.size.body },
  signup: { minHeight: 44, justifyContent: 'center', marginTop: tokens.space['2'] },
  signupText: {
    textAlign: 'center',
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
  },
  signupLink: { color: tokens.color.brand.primary, fontWeight: '700' },
});
