'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DIAL_CODE,
  RESEND_COOLDOWN_SECONDS,
  accountErrorMessage,
  emailSuggestionText,
  emailTypoCheck,
  phoneCodeButtons,
  phoneFieldShowsDialCode,
  smsPhoneError,
  teamPasswordLogin,
  teamResetPassword,
  teamVerifyCode,
  teamVerifyPhoneCode,
  teamWhatsappSignIn,
  type ChannelButton,
} from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert, Checkbox, FieldSuggestion } from '@/components/ui-client';
import { RESTAURANT_SIGNUP_URL, api } from '@/lib/api';
import { restaurantSessionKeeper, getDeviceToken } from '@/lib/auth-storage';
import { WhatsappLogin } from '@/components/WhatsappLogin';
import styles from './page.module.css';

type View =
  | { readonly kind: 'password' }
  | { readonly kind: 'code'; readonly challengeId: string; readonly destination: string }
  | { readonly kind: 'forgot' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'phone' }
  | { readonly kind: 'phone-code' }
  /** FEAT-023 (SPEC-023-07): the code to send on WhatsApp. */
  | { readonly kind: 'whatsapp' };

const HOME = '/restaurant';
const FALLBACK = 'Connexion impossible pour le moment.';

/**
 * Restaurant login (Bloc 10, docs/33 §login; FEAT-021, SPEC-021-03): e-mail and
 * password with the FEAT-020 rules — a code by e-mail on a browser this
 * console does not remember, « Mot de passe oublié ? » — and the phone code
 * only when the server offers SMS or WhatsApp (SPEC-021-02 R5). An account
 * holding neither `restaurant_owner` nor `restaurant_staff` is refused HERE
 * and nothing is kept: every `/restaurants/me` or `/orders` call would fail.
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
  /** FEAT-024 (SPEC-024-01 R8): why the number typed for an SMS cannot get one — under the field. */
  const [phoneError, setPhoneError] = useState<string | null>(null);
  /** The form on screen: the focus goes back to its field after a check (review FEAT-024 #1, #8). */
  const form = useRef<HTMLFormElement>(null);
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

  /** SPEC-024-04 R3, R4: true when the sending stops once to suggest a fixed address. */
  function stopForTypo(): boolean {
    const typo = emailTypoCheck(email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    return typo.suggestion !== null;
  }

  function typeEmail(value: string) {
    typed(setEmail)(value);
    setEmailHint(null);
  }

  const emailSuggestion = (
    <FieldSuggestion
      text={emailHint ? emailSuggestionText(emailHint) : null}
      actionLabel="Oui, corriger"
      onAction={() => {
        if (emailHint) setEmail(emailHint);
        setEmailHint(null);
        setTimeout(
          () => form.current?.querySelector<HTMLElement>('input[type="email"]')?.focus(),
          0,
        );
      }}
    />
  );

  function finish(outcome: 'signed_in' | 'denied') {
    if (outcome === 'signed_in') router.push(HOME);
    else setError(restaurantSessionKeeper.deniedMessage);
  }

  function login() {
    if (stopForTypo()) return;
    void run(async () => {
      const step = await teamPasswordLogin(
        api.auth,
        { email, password, deviceToken: getDeviceToken() },
        restaurantSessionKeeper,
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
          restaurantSessionKeeper,
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
      const step = await teamResetPassword(
        api.auth,
        { email, code, password: newPassword, confirm },
        restaurantSessionKeeper,
      );
      if (step.kind === 'invalid') {
        setFieldErrors(step.errors);
        return;
      }
      setFieldErrors({});
      finish(step.kind);
    });
  }

  function choosePhone(button: ChannelButton) {
    if (!button.enabled) return;
    go(button.id === 'whatsapp' ? { kind: 'whatsapp' } : { kind: 'phone' });
  }

  function requestSmsCode() {
    // FEAT-024 (SPEC-024-01 R8): no SMS to a foreign number or a fixed line — nothing is sent.
    const whatsapp = phoneButtons.some((b) => b.id === 'whatsapp' && b.enabled);
    const why = smsPhoneError(phone, whatsapp);
    setPhoneError(why);
    if (why) {
      setTimeout(() => form.current?.querySelector<HTMLElement>('input[type="tel"]')?.focus(), 0);
      return;
    }
    void run(async () => {
      await api.auth.requestPhoneLoginCode(phone);
      go({ kind: 'phone-code' });
    });
  }

  function verifyPhoneCode() {
    void run(async () => {
      finish(
        await teamVerifyPhoneCode(
          api.auth,
          { channel: 'sms', phone, code },
          restaurantSessionKeeper,
        ),
      );
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
            ? `Entrez le code envoyé au ${phone}.`
            : 'Connexion réservée aux comptes restaurant.';

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>DJAFAT Restaurant</Heading>
          <Text tone="secondary">
            <span id="login-subtitle">{subtitle}</span>
          </Text>
        </Stack>

        {notice && !error && <Alert tone="info">{notice}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        {view.kind === 'password' && (
          <Stack gap="md">
            <form
              ref={form}
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
                  onChange={(e) => typeEmail(e.target.value)}
                  required
                  autoFocus
                />
                {emailSuggestion}
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
                    aria-label={showPassword ? 'Masquer : Mot de passe' : 'Afficher : Mot de passe'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <span aria-hidden="true">👁</span> {showPassword ? 'Masquer' : 'Afficher'}
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
            {/* FEAT-022 (SPEC-022-01 R6): the same sign-up everywhere — the site's restaurant form. */}
            {RESTAURANT_SIGNUP_URL && (
              <p className={cx(styles['signup'])}>
                Pas encore de compte ? <a href={RESTAURANT_SIGNUP_URL}>Inscrire mon restaurant</a>
              </p>
            )}
          </Stack>
        )}

        {view.kind === 'code' && (
          <form
            ref={form}
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
                aria-describedby="login-subtitle"
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
            ref={form}
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
                onChange={(e) => typeEmail(e.target.value)}
                required
                autoFocus
              />
              {emailSuggestion}
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
            ref={form}
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
                aria-describedby="login-subtitle"
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
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              requestSmsCode();
            }}
          >
            <Stack gap="md">
              <Input
                label="Numéro de téléphone"
                type="tel"
                placeholder="66 12 34 56"
                {...(phoneFieldShowsDialCode(phone) ? { leadingText: DIAL_CODE } : {})}
                {...(phoneError ? { error: phoneError } : {})}
                value={phone}
                onChange={(e) => {
                  typed(setPhone)(e.target.value);
                  setPhoneError(null);
                }}
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
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              verifyPhoneCode();
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
                aria-describedby="login-subtitle"
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

        {view.kind === 'whatsapp' && (
          <WhatsappLogin
            onSignedIn={(answer) =>
              void run(async () => {
                const outcome = await teamWhatsappSignIn(answer, restaurantSessionKeeper);
                // SPEC-023-07 R2: refused — back to the form, where the refusal shows.
                if (outcome === 'denied') go({ kind: 'password' });
                finish(outcome);
              })
            }
            onEmailLogin={() => go({ kind: 'password' })}
            onBack={() => go({ kind: 'password' })}
          />
        )}
      </Stack>
    </Container>
  );
}
