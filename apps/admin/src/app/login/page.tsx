'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { setSession, hasAdminAccess, clearSession } from '@/lib/auth-storage';
import styles from './page.module.css';

type Step = 'phone' | 'code';

/**
 * Admin login (Bloc 9, docs/30 §admin-web) — same bounded OTP flow as
 * `apps/web`'s `/connexion` (docs/22 §17.3: no password/session-management
 * UI, just enough to reach `/v1/admin/*`). The one admin-specific step: a
 * successful OTP login whose account does NOT hold `admin`/`super_admin` is
 * refused HERE, client-side, with a clear message — the API would reject
 * every subsequent `/admin/*` call anyway (403), but failing fast at login
 * is a better experience than a logged-in shell showing nothing but errors.
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
    } catch {
      setError("Impossible d'envoyer le code. Vérifiez le numéro (format +235XXXXXXXX).");
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

      if (!hasAdminAccess(result.user)) {
        clearSession();
        setError('Ce compte n’a pas accès à l’administration DJAFAT.');
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
      router.push('/admin');
    } catch {
      setError('Code invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>DJAFAT Admin</Heading>
          <Text tone="secondary">
            {step === 'phone'
              ? 'Connexion réservée au personnel administratif.'
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
