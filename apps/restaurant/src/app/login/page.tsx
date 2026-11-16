'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { setSession, hasRestaurantAccess, clearSession } from '@/lib/auth-storage';
import styles from './page.module.css';

type Step = 'phone' | 'code';

/**
 * A blanket "check the number format" message hid an unreachable API for two
 * debugging sessions — the one failure it never was. Each cause now says what
 * actually happened, so a network or server fault is never mistaken for a
 * typo in the phone number.
 */
function loginError(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'RATE_LIMITED') {
      return 'Trop de codes demandés pour ce numéro. Réessayez dans quelques minutes.';
    }
    if (err.code === 'NETWORK') {
      return `Connexion au serveur impossible (${err.message}). Vérifiez que l’API tourne, puis réessayez.`;
    }
    if (err.code === 'VALIDATION_ERROR' || err.status === 422) {
      return 'Numéro invalide. Utilisez le format international, par exemple +23566000000.';
    }
    return `${err.message} (code ${err.code})`;
  }
  return fallback;
}

/**
 * Restaurant login (Bloc 10, docs/33 §login) — same bounded OTP flow as
 * `apps/admin`'s `/login` (docs/30 §admin-web). The one app-specific step: a
 * successful OTP login whose account holds NEITHER `restaurant_owner` nor
 * `restaurant_staff` is refused HERE, client-side, with a clear message —
 * every subsequent `/restaurants/me`/`/orders` call would 403/404 anyway,
 * but failing fast at login is a better experience than a logged-in shell
 * showing nothing but errors.
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode() {
    setError(null);
    setLoading(true);
    try {
      await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
      setStep('code');
    } catch (err) {
      setError(
        loginError(err, "Impossible d'envoyer le code. Vérifiez le numéro (format +235XXXXXXXX)."),
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setLoading(true);
    try {
      const result = await api.http.post<{
        access: string;
        refresh: string;
        user: { id: string; phone: string; fullName: string | null; roles: string[] };
      }>('/auth/otp/verify', { body: { phone, code, purpose: 'login' } });

      if (!hasRestaurantAccess(result.user)) {
        clearSession();
        setError('Ce compte n’est rattaché à aucun restaurant DJAFAT.');
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
      router.push('/restaurant');
    } catch (err) {
      setError(loginError(err, 'Code invalide ou expiré.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>DJAFAT Restaurant</Heading>
          <Text tone="secondary">
            {step === 'phone'
              ? 'Connexion réservée aux comptes restaurant.'
              : `Entrez le code envoyé au ${phone}.`}
          </Text>
        </Stack>

        {error && <Alert tone="danger">{error}</Alert>}

        {step === 'phone' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestCode();
            }}
          >
            <Stack gap="md">
              <Input
                label="Numéro de téléphone"
                type="tel"
                placeholder="+23566000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
              <Button type="submit" loading={loading} fullWidth>
                Envoyer le code
              </Button>
            </Stack>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode();
            }}
          >
            <Stack gap="md">
              <Input
                label="Code à 6 chiffres"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                required
                autoFocus
              />
              <Button type="submit" loading={loading} fullWidth>
                Vérifier
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('phone')}>
                Changer de numéro
              </Button>
            </Stack>
          </form>
        )}
      </Stack>
    </Container>
  );
}
