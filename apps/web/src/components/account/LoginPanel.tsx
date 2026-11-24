'use client';

import { useState } from 'react';
import type { CodeChannel, CodeChannelId, SignedIn } from '@djafat/sdk';
import { Heading, Stack, Text } from '@djafat/ui';
import { Alert, Button, FieldSuggestion, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { getDeviceToken } from '@/lib/auth-storage';
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
} from '@/lib/account';
import { ChannelRow } from './ChannelRow';
import { CodeStep } from './CodeStep';
import { PasswordField } from './PasswordField';
import styles from './account.module.css';

export type AuthMethods = ReadonlyArray<{ id: string; available: boolean; link?: string }> | null;

type View =
  | { readonly kind: 'password' }
  | {
      readonly kind: 'device';
      readonly challengeId: string;
      readonly channels: readonly CodeChannel[];
      readonly channel: CodeChannelId;
    }
  | { readonly kind: 'email-code'; readonly sent: boolean }
  | { readonly kind: 'phone-code'; readonly channel: 'sms' | 'whatsapp'; readonly sent: boolean }
  | { readonly kind: 'forgot'; readonly sent: boolean };

interface LoginPanelProps {
  readonly methods: AuthMethods;
  readonly onSignedIn: (result: SignedIn) => void;
}

/** What the server's code validity is by default (`otp_ttl_seconds`), as FEAT-020-VIS03 shows it. */
const VALIDITY = 'valable 5 min';

/**
 * « Se connecter » (FEAT-020, SPEC-020-07 R1-R2, SPEC-020-10): e-mail and
 * password, the code of a new device, « Mot de passe oublié ? », and a code
 * alone by e-mail, WhatsApp or SMS — the last two only when the server offers
 * them (« Bientôt disponible » otherwise).
 */
export function LoginPanel({ methods, onSignedIn }: LoginPanelProps) {
  const [view, setView] = useState<View>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [remember, setRemember] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'password' | 'confirm'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Review FEAT-020 #12: after a change of view, its first field takes the focus (not on first load). */
  const [navigated, setNavigated] = useState(false);

  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  /** FEAT-024 (SPEC-024-01 R8): why the number typed for an SMS cannot get one. */
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const whatsappLink = methods?.find((m) => m.id === 'whatsapp')?.link;
  const whatsappAvailable = Boolean(methods?.find((m) => m.id === 'whatsapp')?.available);

  /** SPEC-024-04 R3, R4: true when the sending stops once to suggest a fixed address. */
  function stopForTypo(): boolean {
    const typo = emailTypoCheck(email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    return typo.suggestion !== null;
  }

  const typeEmail = (value: string) => {
    setEmail(value);
    setEmailHint(null);
  };

  const emailSuggestion = (
    <FieldSuggestion
      text={emailHint ? emailSuggestionText(emailHint) : null}
      actionLabel="Oui, corriger"
      onAction={() => {
        if (emailHint) setEmail(emailHint);
        setEmailHint(null);
      }}
    />
  );

  function go(next: View) {
    setError(null);
    setFieldErrors({});
    setView(next);
    setNavigated(true);
  }

  /** Runs one server call with the busy flag and the error message of its real cause. */
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

  const login = () =>
    run('Connexion impossible pour le moment.', async () => {
      const result = await api.auth.passwordLogin({
        email,
        password,
        deviceToken: getDeviceToken(),
      });
      if (result.status === 'signed_in') {
        onSignedIn(result);
        return;
      }
      go({
        kind: 'device',
        challengeId: result.challengeId,
        channels: result.channels,
        channel: 'email',
      });
    });

  function chooseCodeChannel(button: ChannelButton) {
    if (button.id === 'email') go({ kind: 'email-code', sent: false });
    else go({ kind: 'phone-code', channel: button.id, sent: false });
  }

  // ── a new device: the code of the password login ──────────────────────
  if (view.kind === 'device') {
    const current = view.channels.find((c) => c.id === view.channel);
    const usable = channelButtons(view.channels);
    const several = usable.filter((b) => b.enabled).length > 1;
    const openWhatsapp = () => {
      const link = view.channels.find((c) => c.id === 'whatsapp')?.link;
      if (link) window.open(link, '_blank', 'noopener');
    };
    return (
      <CodeStep
        title={view.channel === 'email' ? 'Vérifiez votre e-mail' : 'Nouvel appareil'}
        intro={
          view.channel === 'whatsapp'
            ? 'Envoyez « Code DJAFAT » sur WhatsApp depuis votre numéro, puis entrez le code reçu en réponse.'
            : `Nouvel appareil : entrez le code à 6 chiffres envoyé à ${current?.destination ?? 'votre adresse'} (${VALIDITY}).`
        }
        busy={busy}
        error={error}
        remember={{ checked: remember, onChange: setRemember }}
        before={
          several ? (
            <ChannelRow
              buttons={usable}
              label="Recevoir le code par"
              selected={view.channel}
              onSelect={(b) =>
                void run("Impossible d'envoyer le code.", async () => {
                  if (b.id === 'whatsapp') openWhatsapp();
                  else await api.auth.sendLoginCode(view.challengeId, b.id);
                  setView({ ...view, channel: b.id });
                })
              }
            />
          ) : null
        }
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            onSignedIn(
              await api.auth.verifyLoginCode({
                challengeId: view.challengeId,
                channel: view.channel,
                code,
                rememberDevice: remember,
              }),
            );
          })
        }
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            if (view.channel === 'whatsapp') openWhatsapp();
            else await api.auth.sendLoginCode(view.challengeId, view.channel);
          })
        }
        onBack={() => go({ kind: 'password' })}
      />
    );
  }

  // ── a code alone, by e-mail ───────────────────────────────────────────
  if (view.kind === 'email-code' && view.sent) {
    return (
      <CodeStep
        title="Vérifiez votre e-mail"
        intro={`Entrez le code à 6 chiffres envoyé à ${maskEmail(email)} (${VALIDITY}).`}
        busy={busy}
        error={error}
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            onSignedIn(await api.auth.verifyEmailCode(email, code));
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

  // ── a code alone, by SMS or WhatsApp (FEAT-006, FEAT-008) ─────────────
  if (view.kind === 'phone-code' && view.sent) {
    const byWhatsapp = view.channel === 'whatsapp';
    return (
      <CodeStep
        title={byWhatsapp ? 'Code WhatsApp' : 'Vérifiez vos SMS'}
        intro={
          byWhatsapp
            ? 'Envoyez « Code DJAFAT » sur WhatsApp, puis entrez le code reçu en réponse.'
            : `Entrez le code à 6 chiffres envoyé au ${phone} (${VALIDITY}).`
        }
        busy={busy}
        error={error}
        onSubmit={(code) =>
          void run('Code invalide ou expiré.', async () => {
            const result = byWhatsapp
              ? await api.http.post<SignedIn>('/auth/whatsapp/verify', { body: { phone, code } })
              : await api.http.post<SignedIn>('/auth/otp/verify', {
                  body: { phone, code, purpose: 'login' },
                });
            onSignedIn(result);
          })
        }
        onResend={() =>
          run("Impossible d'envoyer le code.", async () => {
            if (byWhatsapp) {
              if (whatsappLink) window.open(whatsappLink, '_blank', 'noopener');
            } else {
              await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
            }
          })
        }
        onBack={() => go({ kind: 'phone-code', channel: view.channel, sent: false })}
      />
    );
  }

  // ── « Mot de passe oublié ? » : the code and the new password ──────────
  if (view.kind === 'forgot' && view.sent) {
    return (
      <CodeStep
        title="Nouveau mot de passe"
        intro={`Entrez le code à 6 chiffres envoyé à ${maskEmail(email)} (${VALIDITY}), puis choisissez un nouveau mot de passe.`}
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
              onSignedIn(await api.auth.resetPassword({ email, code, password: newPassword }));
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
        <PasswordField
          label="Nouveau mot de passe"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setFieldErrors({});
          }}
          error={fieldErrors.password}
          required
        />
        <PasswordField
          label="Confirmer le mot de passe"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setFieldErrors(({ password }) => (password ? { password } : {}));
          }}
          error={fieldErrors.confirm}
          required
        />
      </CodeStep>
    );
  }

  // ── first screens: e-mail for a code, phone for a code, forgotten password ──
  if (view.kind === 'email-code' || view.kind === 'forgot') {
    const forgot = view.kind === 'forgot';
    return (
      <form
        className={styles['panel']}
        onSubmit={(e) => {
          e.preventDefault();
          if (stopForTypo()) return;
          void run("Impossible d'envoyer le code. Vérifiez l'adresse e-mail.", async () => {
            if (forgot) await api.auth.forgotPassword(email);
            else await api.auth.requestEmailCode(email);
            setView({ ...view, sent: true });
          });
        }}
      >
        <Stack gap="xs">
          <Heading level={2}>
            {forgot ? 'Mot de passe oublié' : 'Recevoir un code par e-mail'}
          </Heading>
          <Text tone="secondary">
            {forgot
              ? 'Saisissez votre e-mail : un code vous permettra de choisir un nouveau mot de passe.'
              : 'Saisissez l’e-mail de votre compte : un code vous connectera sans mot de passe.'}
          </Text>
        </Stack>
        {error && <Alert tone="danger">{error}</Alert>}
        <Input
          autoFocus={navigated}
          label="E-mail"
          type="email"
          autoComplete="email"
          placeholder="vous@gmail.com"
          value={email}
          onChange={(e) => typeEmail(e.target.value)}
          required
        />
        {emailSuggestion}
        <Button type="submit" loading={busy} fullWidth>
          Recevoir un code
        </Button>
        <Button type="button" variant="ghost" fullWidth onClick={() => go({ kind: 'password' })}>
          Retour
        </Button>
      </form>
    );
  }

  if (view.kind === 'phone-code') {
    const byWhatsapp = view.channel === 'whatsapp';
    return (
      <form
        className={styles['panel']}
        onSubmit={(e) => {
          e.preventDefault();
          // SPEC-024-01 R8: no SMS to a foreign number or a fixed line — nothing is sent.
          const why = byWhatsapp ? null : smsPhoneError(phone, whatsappAvailable);
          setPhoneError(why);
          if (why) return;
          void run(
            "Impossible d'envoyer le code. Vérifiez le numéro (ex. 66 12 34 56).",
            async () => {
              if (byWhatsapp) {
                // The customer writes to DJAFAT on WhatsApp; DJAFAT replies with the code (FEAT-008).
                if (whatsappLink) window.open(whatsappLink, '_blank', 'noopener');
              } else {
                await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
              }
              setView({ ...view, sent: true });
            },
          );
        }}
      >
        <Stack gap="xs">
          <Heading level={2}>{byWhatsapp ? 'Code par WhatsApp' : 'Code par SMS'}</Heading>
          <Text tone="secondary">
            {byWhatsapp
              ? 'Gratuit : vous écrivez à DJAFAT sur WhatsApp et recevez votre code en réponse.'
              : 'Recevez un code de connexion par SMS.'}
          </Text>
        </Stack>
        {error && <Alert tone="danger">{error}</Alert>}
        <Input
          autoFocus={navigated}
          label="Numéro de téléphone"
          type="tel"
          autoComplete="tel"
          placeholder="66 12 34 56"
          {...(phoneFieldShowsDialCode(phone) ? { leadingText: DIAL_CODE } : {})}
          {...(phoneError ? { error: phoneError } : {})}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneError(null);
          }}
          required
        />
        <Button type="submit" loading={busy} fullWidth>
          {byWhatsapp ? 'Recevoir mon code sur WhatsApp' : 'Envoyer le code'}
        </Button>
        <Button type="button" variant="ghost" fullWidth onClick={() => go({ kind: 'password' })}>
          Retour
        </Button>
      </form>
    );
  }

  // ── e-mail and password (FEAT-020-VIS01) ──────────────────────────────
  return (
    <form
      className={styles['panel']}
      onSubmit={(e) => {
        e.preventDefault();
        if (stopForTypo()) return;
        void login();
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Input
        autoFocus={navigated}
        label="E-mail"
        type="email"
        autoComplete="email"
        placeholder="vous@gmail.com"
        value={email}
        onChange={(e) => typeEmail(e.target.value)}
        required
      />
      {emailSuggestion}
      <PasswordField
        label="Mot de passe"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Button type="submit" loading={busy} fullWidth>
        Se connecter
      </Button>
      <button
        type="button"
        className={styles['linkButton']}
        onClick={() => go({ kind: 'forgot', sent: false })}
      >
        Mot de passe oublié ?
      </button>
      <p className={styles['separator']}>ou recevoir un code</p>
      <ChannelRow
        buttons={channelButtons(methods)}
        label="Recevoir un code par"
        onSelect={chooseCodeChannel}
      />
    </form>
  );
}
