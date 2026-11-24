'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  accountErrorMessage,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  personNameError,
  type MeProfile,
} from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Alert, Button, FieldSuggestion, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  isAuthenticated,
  setSession,
} from '@/lib/auth-storage';
import { signOut } from '@/lib/session';
import type { AuthMethods } from '@/components/account/LoginPanel';
import { PasswordSection } from '@/components/account/PasswordSection';
import { PhoneSection } from '@/components/account/PhoneSection';
import styles from './page.module.css';

/**
 * "Mon profil": the name shown to the courier and the restaurant, the phone
 * number, and the e-mail (Gmail…) — adding and verifying it with a code makes
 * it usable to log in (FEAT-007). Sign-out lives here, out of the header.
 * FEAT-020 (SPEC-020-09): set or change the password, confirm the number.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [name, setName] = useState('');
  /** FEAT-024 (SPEC-024-03): the name's message, under the field. */
  const [nameError, setNameError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  /** FEAT-020 SPEC-020-12 R1: an account with a password gives it to change its e-mail. */
  const [emailPassword, setEmailPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<AuthMethods | undefined>(undefined);
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger' | 'info';
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await api.auth.me();
      setMe(profile);
      setName(profile.fullName ?? '');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.push('/compte?redirect=/profil' as Route);
      }
    }
  }, [router]);

  useEffect(() => {
    api.auth
      .methods()
      .then((res) => setMethods(res.methods))
      .catch(() => setMethods(null));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/compte?redirect=/profil' as Route);
      return;
    }
    void load();
  }, [load, router]);

  /** Keep the header's stored user in sync after a change. */
  function remember(profile: MeProfile) {
    const access = getAccessToken();
    const refresh = getRefreshToken();
    const stored = getStoredUser();
    if (access && refresh && stored) {
      setSession({ access, refresh, user: { ...stored, fullName: profile.fullName } });
    }
  }

  async function saveName() {
    setMessage(null);
    // SPEC-024-03: a person's name, letters only — checked before sending.
    const why = personNameError(name);
    setNameError(why);
    if (why) return;
    setBusy(true);
    try {
      const profile = await api.auth.updateName(name);
      setMe(profile);
      remember(profile);
      setMessage({ tone: 'success', text: 'Nom enregistré.' });
    } catch (err) {
      const mapped = fieldErrorsFromApi(
        err,
        ['fullName'] as const,
        "Le nom n'a pas pu être enregistré.",
      );
      setNameError(mapped.fields.fullName ?? null);
      if (mapped.general) setMessage({ tone: 'danger', text: mapped.general });
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailCode() {
    // SPEC-024-04 R3, R4: a mistyped address stops the sending once.
    const typo = emailTypoCheck(email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    if (typo.suggestion) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.auth.requestEmailVerification(email, me?.hasPassword ? emailPassword : undefined);
      setCodeSent(true);
      setMessage({ tone: 'info', text: `Un code à 6 chiffres a été envoyé à ${email}.` });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: accountErrorMessage(err, "Impossible d'envoyer le code. Vérifiez l'adresse."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const replaced = Boolean(me?.email && me.emailVerified);
      const profile = await api.auth.confirmEmail(email, code);
      setMe(profile);
      setCodeSent(false);
      setCode('');
      setEmail('');
      setEmailPassword('');
      setMessage({
        tone: 'success',
        text: replaced
          ? 'E-mail changé : votre ancienne adresse a reçu une alerte, et vos appareils mémorisés vous redemanderont un code.'
          : 'E-mail vérifié : vous pouvez maintenant vous connecter avec lui.',
      });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text:
          err instanceof ApiClientError && err.code === 'EMAIL_ALREADY_USED'
            ? 'Cette adresse est déjà utilisée par un autre compte.'
            : 'Code invalide ou expiré.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <Container as="main" maxWidth={480} className={cx(styles['main'])}>
        <Text tone="secondary">Chargement…</Text>
      </Container>
    );
  }

  return (
    <Container as="main" maxWidth={480} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Heading level={1}>Mon profil</Heading>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <PhoneSection
          me={me}
          methods={methods}
          onUpdated={(profile) => {
            setMe(profile);
            setMessage({ tone: 'success', text: 'Numéro confirmé.' });
          }}
          cardClassName={styles['card'] ?? ''}
          labelClassName={styles['label'] ?? ''}
          valueClassName={styles['value'] ?? ''}
          okClassName={styles['ok'] ?? ''}
          mutedClassName={styles['muted'] ?? ''}
        />

        <section className={cx(styles['card'])}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <Stack gap="sm">
              <Input
                label="Votre nom"
                helpText="Affiché au livreur et au restaurant."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                {...(nameError ? { error: nameError } : {})}
                required
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                Enregistrer le nom
              </Button>
            </Stack>
          </form>
        </section>

        <section className={cx(styles['card'])}>
          <p className={cx(styles['label'])}>E-mail (Gmail ou autre)</p>
          {me.email && me.emailVerified ? (
            <p className={cx(styles['value'])}>
              {me.email} <span className={cx(styles['ok'])}>✓ vérifié</span>
            </p>
          ) : (
            <p className={cx(styles['muted'])}>
              Aucun e-mail vérifié. Ajoutez-en un pour pouvoir vous connecter avec.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (codeSent ? confirmEmail() : sendEmailCode());
            }}
          >
            <Stack gap="sm">
              <Input
                label={me.emailVerified ? 'Changer d’e-mail' : 'Ajouter un e-mail'}
                type="email"
                placeholder="vous@gmail.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailHint(null);
                }}
                disabled={codeSent}
                required
              />
              <FieldSuggestion
                text={emailHint ? emailSuggestionText(emailHint) : null}
                actionLabel="Oui, corriger"
                onAction={() => {
                  if (emailHint) setEmail(emailHint);
                  setEmailHint(null);
                }}
              />
              {me.hasPassword && !codeSent && (
                <Input
                  label="Mot de passe actuel"
                  type="password"
                  autoComplete="current-password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                />
              )}
              {codeSent && (
                <Input
                  label="Code reçu par e-mail"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              )}
              <Button type="submit" disabled={busy}>
                {codeSent ? 'Vérifier le code' : 'Recevoir un code'}
              </Button>
              {codeSent && (
                <Button type="button" variant="ghost" onClick={() => setCodeSent(false)}>
                  Changer d’adresse
                </Button>
              )}
            </Stack>
          </form>
        </section>

        <PasswordSection
          me={me}
          onChanged={() => void load()}
          cardClassName={styles['card'] ?? ''}
          labelClassName={styles['label'] ?? ''}
          mutedClassName={styles['muted'] ?? ''}
        />

        <Button variant="ghost" fullWidth onClick={() => void signOut()}>
          Se déconnecter
        </Button>
      </Stack>
    </Container>
  );
}
