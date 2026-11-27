import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, type TextInput } from 'react-native';
import type { CodeChannel, CodeChannelId, SignedIn } from '@djafat/sdk';
import { Button } from '../Button';
import { api } from '../../lib/api';
import { loadDeviceToken } from '../../lib/auth-storage';
import {
  DIAL_CODE,
  accountErrorMessage,
  channelButtons,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  maskEmail,
  phoneFieldShowsDialCode,
  smsPhoneError,
  validateNewPassword,
  type ChannelButton,
  type FieldErrors,
} from '../../lib/account';
import { ChannelRow } from './ChannelRow';
import { CodeStep } from './CodeStep';
import { Field } from './Field';
import { WhatsappStep } from './WhatsappStep';
import { accountStyles as s } from './styles';

export type AuthMethods = ReadonlyArray<{ id: string; available: boolean }> | null;

type View_ =
  | { readonly kind: 'password' }
  | {
      readonly kind: 'device';
      readonly challengeId: string;
      readonly channels: readonly CodeChannel[];
      readonly channel: CodeChannelId;
    }
  | { readonly kind: 'email-code'; readonly sent: boolean }
  | { readonly kind: 'phone-code'; readonly sent: boolean }
  /** FEAT-023: the code to SEND on WhatsApp (FEAT-023-VIS02). */
  | { readonly kind: 'whatsapp' }
  | { readonly kind: 'forgot'; readonly sent: boolean };

const VALIDITY = 'valable 5 min';

/**
 * « Se connecter » in the app (FEAT-020, SPEC-020-08): the same flows as the
 * site's `LoginPanel` — password, new device's code, forgotten password, a
 * code alone by e-mail, WhatsApp or SMS (« Bientôt disponible » when off). By
 * WhatsApp the customer SENDS the code shown (FEAT-023, SPEC-023-05).
 */
export function LoginForm({
  methods,
  onSignedIn,
  onCreateAccount,
}: {
  readonly methods: AuthMethods;
  readonly onSignedIn: (result: SignedIn) => Promise<void>;
  /** FEAT-023 (SPEC-023-05 R4): « Créer un compte » with the number that wrote. */
  readonly onCreateAccount?: (phone: string) => void;
}) {
  const [view, setView] = useState<View_>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [remember, setRemember] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'password' | 'confirm'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  useEffect(() => {
    void loadDeviceToken().then(setDeviceToken);
  }, []);

  const whatsappAvailable = Boolean(methods?.find((m) => m.id === 'whatsapp')?.available);

  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  /** FEAT-024 (SPEC-024-01 R8): why the number typed for an SMS cannot get one. */
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  /** SPEC-024-04 R3, R4: true when the sending stops once to suggest a fixed address. */
  function stopForTypo(): boolean {
    const typo = emailTypoCheck(email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    return typo.suggestion !== null;
  }

  const typeEmail = (text: string) => {
    setEmail(text);
    setEmailHint(null);
  };

  const emailSuggestion = emailHint
    ? {
        text: emailSuggestionText(emailHint),
        onAccept: () => {
          setEmail(emailHint);
          setEmailHint(null);
          emailRef.current?.focus();
        },
      }
    : null;

  function go(next: View_) {
    setError(null);
    setFieldErrors({});
    setView(next);
  }

  async function run(fallback: string, action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(accountErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  function chooseCodeChannel(button: ChannelButton) {
    if (button.id === 'email') go({ kind: 'email-code', sent: false });
    else if (button.id === 'whatsapp') go({ kind: 'whatsapp' });
    else go({ kind: 'phone-code', sent: false });
  }

  if (view.kind === 'device') {
    // FEAT-023 (SPEC-023-05 R6): by WhatsApp the customer sends a code for this login.
    if (view.channel === 'whatsapp') {
      return (
        <WhatsappStep
          purpose="login"
          start={() => api.auth.startWhatsapp({ challengeId: view.challengeId })}
          remember={{ checked: remember, onChange: setRemember }}
          onSignedIn={onSignedIn}
          backLabel="Recevoir le code par e-mail"
          onBack={() => setView({ ...view, channel: 'email' })}
        />
      );
    }
    const channel = view.channel;
    const current = view.channels.find((c) => c.id === channel);
    const usable = channelButtons(view.channels);
    const several = usable.filter((b) => b.enabled).length > 1;
    return (
      <CodeStep
        title={channel === 'email' ? 'Vérifiez votre e-mail' : 'Nouvel appareil'}
        intro={`Nouvel appareil : entrez le code à 6 chiffres envoyé à ${current?.destination ?? 'votre adresse'} (${VALIDITY}).`}
        busy={busy}
        error={error}
        remember={{ checked: remember, onChange: setRemember }}
        before={
          several ? (
            <ChannelRow
              buttons={usable}
              label="Recevoir le code par"
              selected={channel}
              onSelect={(b) => {
                const next = b.id;
                if (next === 'whatsapp') {
                  setView({ ...view, channel: 'whatsapp' });
                  return;
                }
                void run("Impossible d'envoyer le code.", async () => {
                  await api.auth.sendLoginCode(view.challengeId, next);
                  setView({ ...view, channel: next });
                });
              }}
            />
          ) : null
        }
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            await onSignedIn(
              await api.auth.verifyLoginCode({
                challengeId: view.challengeId,
                channel,
                code,
                rememberDevice: remember,
              }),
            );
          })
        }
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            await api.auth.sendLoginCode(view.challengeId, channel);
          })
        }
        onBack={() => go({ kind: 'password' })}
      />
    );
  }

  // FEAT-023 (SPEC-023-05): the code to send on WhatsApp.
  if (view.kind === 'whatsapp') {
    return (
      <WhatsappStep
        purpose="login"
        start={() => api.auth.startWhatsapp()}
        onSignedIn={onSignedIn}
        {...(onCreateAccount ? { onCreateAccount } : {})}
        onEmailLogin={() => go({ kind: 'password' })}
        onBack={() => go({ kind: 'password' })}
      />
    );
  }

  if (view.kind === 'email-code' && view.sent) {
    return (
      <CodeStep
        title="Vérifiez votre e-mail"
        intro={`Entrez le code à 6 chiffres envoyé à ${maskEmail(email.trim().toLowerCase())} (${VALIDITY}).`}
        busy={busy}
        error={error}
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            await onSignedIn(await api.auth.verifyEmailCode(email, code));
          })
        }
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            await api.auth.requestEmailCode(email);
          })
        }
        onBack={() => go({ kind: 'email-code', sent: false })}
      />
    );
  }

  if (view.kind === 'phone-code' && view.sent) {
    return (
      <CodeStep
        title="Vérifiez vos SMS"
        intro={`Entrez le code à 6 chiffres envoyé au ${phone} (${VALIDITY}).`}
        busy={busy}
        error={error}
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            await onSignedIn(
              await api.http.post<SignedIn>('/auth/otp/verify', {
                body: { phone, code, purpose: 'login' },
              }),
            );
          })
        }
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
          })
        }
        onBack={() => go({ kind: 'phone-code', sent: false })}
      />
    );
  }

  if (view.kind === 'forgot' && view.sent) {
    return (
      <CodeStep
        title="Nouveau mot de passe"
        intro={`Entrez le code à 6 chiffres envoyé à ${maskEmail(email.trim().toLowerCase())} (${VALIDITY}), puis choisissez un nouveau mot de passe.`}
        busy={busy}
        error={error}
        submitLabel="Changer le mot de passe"
        onSubmit={(code) => {
          const errors = validateNewPassword(newPassword, confirm, { email });
          setFieldErrors(errors);
          if (Object.keys(errors).length > 0) return;
          void (async () => {
            setError(null);
            setBusy(true);
            try {
              await onSignedIn(
                await api.auth.resetPassword({ email, code, password: newPassword }),
              );
            } catch (err) {
              const mapped = fieldErrorsFromApi(
                err,
                ['password'] as const,
                'Code invalide ou expiré.',
              );
              setFieldErrors(mapped.fields);
              setError(mapped.general);
            } finally {
              setBusy(false);
            }
          })();
        }}
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            await api.auth.forgotPassword(email);
          })
        }
        onBack={() => go({ kind: 'forgot', sent: false })}
      >
        <Field
          label="Nouveau mot de passe"
          secret
          textContentType="newPassword"
          value={newPassword}
          onChangeText={(v) => {
            setNewPassword(v);
            setFieldErrors({});
          }}
          error={fieldErrors.password}
        />
        <Field
          label="Confirmer le mot de passe"
          secret
          textContentType="newPassword"
          value={confirm}
          onChangeText={(v) => {
            setConfirm(v);
            setFieldErrors(({ password }) => (password ? { password } : {}));
          }}
          error={fieldErrors.confirm}
        />
      </CodeStep>
    );
  }

  if (view.kind === 'email-code' || view.kind === 'forgot') {
    const forgot = view.kind === 'forgot';
    return (
      <View style={s.form}>
        <Text style={s.heading} accessibilityRole="header">
          {forgot ? 'Mot de passe oublié' : 'Recevoir un code par e-mail'}
        </Text>
        <Text style={s.intro}>
          {forgot
            ? 'Saisissez votre e-mail : un code vous permettra de choisir un nouveau mot de passe.'
            : 'Saisissez l’e-mail de votre compte : un code vous connectera sans mot de passe.'}
        </Text>
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        <Field
          inputRef={emailRef}
          label="E-mail"
          value={email}
          onChangeText={typeEmail}
          placeholder="vous@gmail.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          suggestion={emailSuggestion}
        />
        <Button
          label="Recevoir un code"
          loading={busy}
          fullWidth
          onPress={() =>
            !stopForTypo() &&
            void run("Impossible d'envoyer le code. Vérifiez l'adresse e-mail.", async () => {
              if (forgot) await api.auth.forgotPassword(email);
              else await api.auth.requestEmailCode(email);
              setView({ ...view, sent: true });
            })
          }
        />
        <Button label="Retour" variant="ghost" fullWidth onPress={() => go({ kind: 'password' })} />
      </View>
    );
  }

  if (view.kind === 'phone-code') {
    return (
      <View style={s.form}>
        <Text style={s.heading} accessibilityRole="header">
          Code par SMS
        </Text>
        <Text style={s.intro}>Recevez un code de connexion par SMS.</Text>
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        <Field
          inputRef={phoneRef}
          label="Numéro de téléphone"
          value={phone}
          onChangeText={(text) => {
            setPhone(text);
            setPhoneError(null);
          }}
          placeholder="66 12 34 56"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          leadingText={phoneFieldShowsDialCode(phone) ? DIAL_CODE : undefined}
          error={phoneError ?? undefined}
        />
        <Button
          label="Envoyer le code"
          loading={busy}
          fullWidth
          onPress={() => {
            // SPEC-024-01 R8: no SMS to a foreign number or a fixed line — nothing is sent.
            const why = smsPhoneError(phone, whatsappAvailable);
            setPhoneError(why);
            if (why) {
              phoneRef.current?.focus();
              return;
            }
            void run(
              "Impossible d'envoyer le code. Vérifiez le numéro (ex. 66 12 34 56).",
              async () => {
                await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
                setView({ ...view, sent: true });
              },
            );
          }}
        />
        <Button label="Retour" variant="ghost" fullWidth onPress={() => go({ kind: 'password' })} />
      </View>
    );
  }

  return (
    <View style={s.form}>
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
      <Field
        inputRef={emailRef}
        label="E-mail"
        value={email}
        onChangeText={typeEmail}
        placeholder="vous@gmail.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoCapitalize="none"
        suggestion={emailSuggestion}
      />
      <Field
        label="Mot de passe"
        secret
        textContentType="password"
        value={password}
        onChangeText={setPassword}
      />
      <Button
        label="Se connecter"
        loading={busy}
        fullWidth
        onPress={() =>
          !stopForTypo() &&
          void run('Connexion impossible pour le moment.', async () => {
            const result = await api.auth.passwordLogin({ email, password, deviceToken });
            if (result.status === 'signed_in') {
              await onSignedIn(result);
              return;
            }
            go({
              kind: 'device',
              challengeId: result.challengeId,
              channels: result.channels,
              channel: 'email',
            });
          })
        }
      />
      <Pressable accessibilityRole="button" onPress={() => go({ kind: 'forgot', sent: false })}>
        <Text style={s.link}>Mot de passe oublié ?</Text>
      </Pressable>
      <Text style={s.separator}>— ou recevoir un code —</Text>
      <ChannelRow
        buttons={channelButtons(methods)}
        label="Recevoir un code par"
        onSelect={chooseCodeChannel}
      />
    </View>
  );
}
