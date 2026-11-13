'use client';

import { Suspense, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Heading, Text, Stack, cx } from '@djafat/ui';
import { Button, Input, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth-storage';
import styles from './page.module.css';

type Step = 'start' | 'code';
type Method = 'whatsapp' | 'sms' | 'email';

/**
 * Login (docs/22 §17.3, FEAT-007, FEAT-008): the customer picks how to get a
 * 6-digit code — WhatsApp (free for DJAFAT: the customer writes "Code DJAFAT",
 * DJAFAT replies), SMS, or e-mail (an address already verified on the
 * account, e.g. a Gmail address). Only the methods the server reports as
 * available (`GET /auth/methods`) are offered.
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

  const [available, setAvailable] = useState<Array<{ id: Method; link?: string }>>([]);
  const [method, setMethod] = useState<Method>('sms');
  const [step, setStep] = useState<Step>('start');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.auth
      .methods()
      .then((res) => {
        const list = res.methods.filter((m) => m.available);
        setAvailable(list.map((m) => ({ id: m.id, ...(m.link ? { link: m.link } : {}) })));
        if (list[0]) setMethod(list[0].id);
      })
      .catch(() => setAvailable([{ id: 'sms' }]));
  }, []);

  const waLink = available.find((m) => m.id === 'whatsapp')?.link;

  function choose(m: Method) {
    setMethod(m);
    setStep('start');
    setError(null);
    setCode('');
  }

  async function requestCode() {
    setError(null);
    setLoading(true);
    try {
      if (method === 'whatsapp') {
        // The customer writes to DJAFAT on WhatsApp; DJAFAT replies with the code.
        if (waLink) window.open(waLink, '_blank', 'noopener');
      } else if (method === 'email') {
        await api.http.post('/auth/email/request', { body: { email } });
      } else {
        await api.http.post('/auth/otp/request', { body: { phone, purpose: 'login' } });
      }
      setStep('code');
    } catch {
      setError(
        method === 'email'
          ? "Impossible d'envoyer le code. Vérifiez l'adresse e-mail."
          : "Impossible d'envoyer le code. Vérifiez le numéro (ex. 66 12 34 56).",
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setLoading(true);
    try {
      type LoginResult = {
        access: string;
        refresh: string;
        user: { id: string; phone: string; fullName: string | null; roles: string[] };
      };
      const result =
        method === 'whatsapp'
          ? await api.http.post<LoginResult>('/auth/whatsapp/verify', { body: { phone, code } })
          : method === 'email'
            ? await api.http.post<LoginResult>('/auth/email/verify', { body: { email, code } })
            : await api.http.post<LoginResult>('/auth/otp/verify', {
                body: { phone, code, purpose: 'login' },
              });
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
    } catch {
      setError('Code invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }

  const LABELS: Record<Method, { icon: string; name: string }> = {
    whatsapp: { icon: '🟢', name: 'WhatsApp' },
    sms: { icon: '💬', name: 'SMS' },
    email: { icon: '✉️', name: 'E-mail' },
  };

  const intro =
    step === 'code'
      ? method === 'email'
        ? `Entrez le code envoyé à ${email}.`
        : method === 'whatsapp'
          ? 'Envoyez le message « Code DJAFAT » sur WhatsApp, puis entrez le code reçu en réponse.'
          : `Entrez le code envoyé au ${phone}.`
      : method === 'whatsapp'
        ? 'Gratuit : vous écrivez à DJAFAT sur WhatsApp et recevez votre code en réponse.'
        : method === 'email'
          ? 'Pour les comptes qui ont déjà ajouté leur e-mail (Gmail, etc.).'
          : 'Recevez un code de vérification par SMS.';

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Heading level={1}>Connexion</Heading>
          <Text tone="secondary">{intro}</Text>
        </Stack>

        {available.length > 1 && (
          <div className={cx(styles['methods'])} role="tablist" aria-label="Moyen de connexion">
            {available.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={method === m.id}
                className={cx(styles['method'], method === m.id && styles['methodActive'])}
                onClick={() => choose(m.id)}
              >
                <span aria-hidden="true">{LABELS[m.id].icon}</span> {LABELS[m.id].name}
              </button>
            ))}
          </div>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        {step === 'start' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestCode();
            }}
          >
            <Stack gap="md">
              {method === 'email' ? (
                <Input
                  label="Adresse e-mail"
                  type="email"
                  placeholder="vous@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              ) : (
                <Input
                  label="Numéro de téléphone"
                  type="tel"
                  placeholder="66 12 34 56"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              )}
              <Button type="submit" loading={loading} fullWidth>
                {method === 'whatsapp' ? 'Recevoir mon code sur WhatsApp' : 'Envoyer le code'}
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
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('start')}>
                Retour
              </Button>
            </Stack>
          </form>
        )}
      </Stack>
    </Container>
  );
}
