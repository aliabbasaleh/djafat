'use client';

import { Suspense, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth-storage';
import styles from './page.module.css';

type Step = 'phone' | 'code';

/**
 * A blanket "check the number format" message hid a real `Illegal invocation`
 * bug for an entire debugging session — the one failure it never was. Each
 * cause now says what actually happened.
 */
function otpRequestError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'RATE_LIMITED') {
      return 'Trop de codes demandés pour ce numéro. Réessayez dans quelques minutes.';
    }
    if (err.code === 'VALIDATION_ERROR' || err.status === 422) {
      return 'Numéro invalide. Utilisez le format international, par exemple +23566000000.';
    }
    if (err.code === 'NETWORK') {
      return `Connexion au serveur impossible (${err.message}). Vérifiez votre connexion et réessayez.`;
    }
    return `${err.message} (code ${err.code})`;
  }
  return "Impossible d'envoyer le code. Réessayez dans un instant.";
}

/**
 * Minimal OTP login (docs/22 §17.3) — the cart requires an authenticated
 * actor and Bloc 2/3 never built a login page. Two steps, no MFA/step-up
 * UI (that's an admin-only concern, docs/19 §22, not needed by a customer).
 */
export default function ConnexionPage() {
  return (
    <Suspense fallback={null}>
      <ConnexionForm />
    </Suspense>
  );
}

function ConnexionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/';

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
      setError(otpRequestError(err));
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
      router.push(redirectTo as Route);
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === 'NETWORK'
          ? `Connexion au serveur impossible (${err.message}).`
          : 'Code invalide ou expiré.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>Connexion</Heading>
          <Text tone="secondary">
            {step === 'phone'
              ? 'Recevez un code de vérification par SMS.'
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
