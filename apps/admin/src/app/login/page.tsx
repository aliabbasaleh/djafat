'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RESEND_COOLDOWN_SECONDS,
  accountErrorMessage,
  phoneCodeButtons,
  teamPasswordLogin,
  teamResetPassword,
  teamVerifyCode,
  validateNewPassword,
  type ChannelButton,
} from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert, Checkbox } from '@/components/ui-client';
import { api } from '@/lib/api';
import {
  adminSessionKeeper,
  clearSession,
  getDeviceToken,
  hasAdminAccess,
  setSession,
} from '@/lib/auth-storage';
import styles from './page.module.css';

type PhoneChannel = 'sms' | 'whatsapp';
type View =
  | { readonly kind: 'password' }
  | { readonly kind: 'code'; readonly challengeId: string; readonly destination: string }
  | { readonly kind: 'forgot' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'phone'; readonly channel: PhoneChannel }
  | { readonly kind: 'phone-code'; readonly channel: PhoneChannel };

const DENIED = 'Ce compte n’a pas accès à l’administration DJAFAT.';
const HOME = '/admin';
const FALLBACK = 'Connexion impossible pour le moment.';

/**
 * Admin login (Bloc 9, docs/30 §admin-web; FEAT-021, SPEC-021-03): e-mail and
 * password with the FEAT-020 rules — a code by e-mail on a browser this
 * console does not remember, « Mot de passe oublié ? » — and the phone code
 * only when the server offers SMS or WhatsApp (SPEC-021-02 R5). An account
 * without an admin role is refused HERE and nothing is kept: the API would
 * reject every `/admin/*` call anyway (403).
 */
export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'password' });
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

  function go(next: View, message: string | null = null) {
    setError(null);
    setNotice(message);
    setCode('');
    setFieldErrors({});
    setView(next);
  }

  /** R2: an error disappears as soon as a field changes. */
  function typed(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setError(null);
    };
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
    if (outcome === 'signed_in') router.push(HOME);
    else setError(DENIED);
  }

  function login() {
    void run(async () => {
      const step = await teamPasswordLogin(
        api.auth,
        { email, password, deviceToken: getDeviceToken() },
        adminSessionKeeper,
      );
      if (step.kind === 'code') {
        setCooldown(RESEND_COOLDOWN_SECONDS);
        go({ kind: 'code', challengeId: step.challengeId, destination: step.destination });
      } else {
        finish(step.kind);
      }
    });
  }

  function verify(challengeId: string) {
    void run(async () => {
      finish(
        await teamVerifyCode(
          api.auth,
          { challengeId, code, rememberDevice: remember },
          adminSessionKeeper,
        ),
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
    const errors = validateNewPassword(newPassword, confirm, { email });
    setFieldErrors(errors);
    if (errors.password || errors.confirm) return;
    void run(async () => {
      finish(
        await teamResetPassword(
          api.auth,
          { email, code, password: newPassword },
          adminSessionKeeper,
        ),
      );
    });
  }

  function choosePhone(button: ChannelButton) {
    if (!button.enabled) return;
    if (button.id === 'whatsapp') {
      if (button.link) window.open(button.link, '_blank', 'noopener');
      go({ kind: 'phone-code', channel: 'whatsapp' });
    } else {
      go({ kind: 'phone', channel: 'sms' });
    }
  }

  function requestSmsCode() {
    void run(async () => {
      await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
      go({ kind: 'phone-code', channel: 'sms' });
    });
  }

  function verifyPhoneCode(channel: PhoneChannel) {
    void run(async () => {
      const result = await api.http.post<{
        access: string;
        refresh: string;
        user: { id: string; phone: string; fullName: string | null; roles: string[] };
      }>(channel === 'whatsapp' ? '/auth/whatsapp/verify' : '/auth/otp/verify', {
        body: channel === 'whatsapp' ? { phone, code } : { phone, code, purpose: 'login' },
      });
      if (!hasAdminAccess(result.user)) {
        clearSession();
        setError(DENIED);
        return;
      }
      setSession({
        access: result.access,
        refresh: result.refresh,
        user: {
          id: result.user.id,
          phone: result.user.phone,
          fullName: result.user.fullName,
          roles: result.user.roles,
        },
      });
      router.push(HOME);
    });
  }

  const subtitle =
    view.kind === 'code'
      ? `Code envoyé à ${view.destination}.`
      : view.kind === 'forgot'
        ? 'Recevez un code par e-mail pour choisir un nouveau mot de passe.'
        : view.kind === 'reset'
          ? `Saisissez le code reçu à ${email} et votre nouveau mot de passe.`
          : view.kind === 'phone-code'
            ? view.channel === 'whatsapp'
              ? 'Envoyez « Code DJAFAT » sur WhatsApp, puis saisissez le code reçu.'
              : `Entrez le code envoyé au ${phone}.`
            : 'Connexion réservée au personnel administratif.';

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>DJAFAT Admin</Heading>
          <Text tone="secondary">{subtitle}</Text>
        </Stack>

        {notice && !error && <Alert tone="info">{notice}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        {view.kind === 'password' && (
          <Stack gap="md">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login();
              }}
            >
              <Stack gap="md">
                <Input
                  label="E-mail"
                  type="email"
                  autoComplete="email"
                  placeholder="vous@gmail.com"
                  value={email}
                  onChange={(e) => typed(setEmail)(e.target.value)}
                  required
                  autoFocus
                />
                <div className={cx(styles['passwordRow'])}>
                  <Input
                    label="Mot de passe"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => typed(setPassword)(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className={cx(styles['toggle'])}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? 'Masquer' : 'Afficher'}
                  </button>
                </div>
                <Button type="submit" loading={loading} fullWidth>
                  Se connecter
                </Button>
              </Stack>
            </form>
            <Button type="button" variant="ghost" fullWidth onClick={() => go({ kind: 'forgot' })}>
              Mot de passe oublié ?
            </Button>
            {phoneButtons.length > 0 && (
              <Stack gap="sm">
                <p className={cx(styles['divider'])}>ou recevoir un code par téléphone</p>
                <div className={cx(styles['channels'])}>
                  {phoneButtons.map((button) => (
                    <button
                      key={button.id}
                      type="button"
                      className={cx(styles['channel'])}
                      disabled={!button.enabled}
                      onClick={() => choosePhone(button)}
                    >
                      <span>{button.label}</span>
                      {button.note && (
                        <span className={cx(styles['channelNote'])}>{button.note}</span>
                      )}
                    </button>
                  ))}
                </div>
              </Stack>
            )}
          </Stack>
        )}

        {view.kind === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify(view.challengeId);
            }}
          >
            <Stack gap="md">
              <Input
                label="Code à 6 chiffres"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => typed(setCode)(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
              />
              <Checkbox
                label="Se souvenir de cet appareil (30 jours)"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <Button type="submit" loading={loading} fullWidth>
                Vérifier
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={cooldown > 0 || loading}
                onClick={() => resendLoginCode(view.challengeId)}
              >
                {cooldown > 0 ? `Renvoyer le code (dans ${cooldown} s)` : 'Renvoyer le code'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => go({ kind: 'password' })}
              >
                Retour
              </Button>
            </Stack>
          </form>
        )}

        {view.kind === 'forgot' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              askResetCode();
            }}
          >
            <Stack gap="md">
              <Input
                label="E-mail"
                type="email"
                autoComplete="email"
                placeholder="vous@gmail.com"
                value={email}
                onChange={(e) => typed(setEmail)(e.target.value)}
                required
                autoFocus
              />
              <Button type="submit" loading={loading} fullWidth>
                Recevoir un code
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => go({ kind: 'password' })}
              >
                Retour
              </Button>
            </Stack>
          </form>
        )}

        {view.kind === 'reset' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset();
            }}
          >
            <Stack gap="md">
              <Input
                label="Code à 6 chiffres"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => typed(setCode)(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
              />
              <Input
                label="Nouveau mot de passe"
                type="password"
                autoComplete="new-password"
                helpText="Au moins 8 caractères."
                value={newPassword}
                {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
                onChange={(e) => {
                  typed(setNewPassword)(e.target.value);
                  setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
                required
              />
              <Input
                label="Confirmer le mot de passe"
                type="password"
                autoComplete="new-password"
                value={confirm}
                {...(fieldErrors.confirm ? { error: fieldErrors.confirm } : {})}
                onChange={(e) => {
                  typed(setConfirm)(e.target.value);
                  setFieldErrors((f) => ({ ...f, confirm: undefined }));
                }}
                required
              />
              <Button type="submit" loading={loading} fullWidth>
                Changer le mot de passe
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={cooldown > 0 || loading}
                onClick={askResetCode}
              >
                {cooldown > 0 ? `Renvoyer le code (dans ${cooldown} s)` : 'Renvoyer le code'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => go({ kind: 'password' })}
              >
                Retour
              </Button>
            </Stack>
          </form>
        )}

        {view.kind === 'phone' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestSmsCode();
            }}
          >
            <Stack gap="md">
              <Input
                label="Numéro de téléphone"
                type="tel"
                placeholder="+23566000000"
                value={phone}
                onChange={(e) => typed(setPhone)(e.target.value)}
                required
                autoFocus
              />
              <Button type="submit" loading={loading} fullWidth>
                Envoyer le code
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => go({ kind: 'password' })}
              >
                Retour
              </Button>
            </Stack>
          </form>
        )}

        {view.kind === 'phone-code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyPhoneCode(view.channel);
            }}
          >
            <Stack gap="md">
              {view.channel === 'whatsapp' && (
                <Input
                  label="Numéro de téléphone"
                  type="tel"
                  placeholder="+23566000000"
                  value={phone}
                  onChange={(e) => typed(setPhone)(e.target.value)}
                  required
                />
              )}
              <Input
                label="Code à 6 chiffres"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => typed(setCode)(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
              />
              <Button type="submit" loading={loading} fullWidth>
                Vérifier
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => go({ kind: 'password' })}
              >
                Retour
              </Button>
            </Stack>
          </form>
        )}
      </Stack>
    </Container>
  );
}
