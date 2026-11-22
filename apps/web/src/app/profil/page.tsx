'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ApiClientError, type MeProfile } from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
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
  const [email, setEmail] = useState('');
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
    setBusy(true);
    setMessage(null);
    try {
      const profile = await api.auth.updateName(name);
      setMe(profile);
      remember(profile);
      setMessage({ tone: 'success', text: 'Nom enregistré.' });
    } catch {
      setMessage({ tone: 'danger', text: 'Nom invalide (2 à 80 caractères).' });
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailCode() {
    setBusy(true);
    setMessage(null);
    try {
      await api.auth.requestEmailVerification(email);
      setCodeSent(true);
      setMessage({ tone: 'info', text: `Un code à 6 chiffres a été envoyé à ${email}.` });
    } catch {
      setMessage({ tone: 'danger', text: "Impossible d'envoyer le code. Vérifiez l'adresse." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const profile = await api.auth.confirmEmail(email, code);
      setMe(profile);
      setCodeSent(false);
      setCode('');
      setEmail('');
      setMessage({
        tone: 'success',
        text: 'E-mail vérifié : vous pouvez maintenant vous connecter avec lui.',
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
                onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setEmail(e.target.value)}
                disabled={codeSent}
                required
              />
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
