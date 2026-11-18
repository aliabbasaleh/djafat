'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type MfaEnrolment, type MfaStatus } from '@djafat/sdk';
import { Heading, Stack, Text, Skeleton, ErrorState, Badge } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';

/** The base32 key in groups of four, easier to type into an authenticator app. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Audit ADM-03: the console had no MFA screen, so every action that needs a
 * second factor (roles, account status, refunds, order cancellation) failed.
 * Here a staff member (admin, super_admin, finance) turns MFA on: the API
 * gives a key once, the authenticator app (Google Authenticator, Microsoft
 * Authenticator…) turns it into 6-digit codes, and the first code confirms.
 */
export default function SecurityPage() {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setStatus(await api.auth.mfaStatus());
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      setLoadError(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      setEnrolment(await api.auth.mfaSetup());
      setCode('');
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof ApiClientError ? err.message : 'Impossible de démarrer l’activation.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.auth.mfaVerify(code);
      setEnrolment(null);
      setCode('');
      setMessage({
        tone: 'success',
        text: result.justEnabled
          ? 'Double authentification activée. Vous pouvez faire les actions protégées pendant 10 minutes.'
          : 'Code vérifié : les actions protégées sont ouvertes pendant 10 minutes.',
      });
      await load();
    } catch (err) {
      setMessage({
        tone: 'danger',
        text:
          err instanceof ApiClientError && err.code === 'MFA_INVALID'
            ? 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.'
            : err instanceof ApiClientError
              ? err.message
              : 'La vérification n’a pas abouti.',
      });
    } finally {
      setBusy(false);
    }
  }

  const codeField = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <Stack gap="sm">
        <Input
          label="Code à 6 chiffres"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <div>
          <Button type="submit" loading={busy} disabled={!/^\d{6}$/.test(code)}>
            Confirmer
          </Button>
        </div>
      </Stack>
    </form>
  );

  return (
    <Stack gap="lg">
      <Heading level={1}>Sécurité</Heading>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {loadError && (
        <ErrorState
          title="Impossible de lire l’état de la double authentification"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      )}
      {!status && !loadError && <Skeleton height={120} radius="8px" />}

      {status?.enabled && (
        <Stack gap="md">
          <Text>
            Double authentification : <Badge tone="success">activée</Badge>
          </Text>
          <Text tone="secondary">
            {status.stepUpValidUntil
              ? `Actions protégées ouvertes jusqu’à ${formatTime(status.stepUpValidUntil)}.`
              : 'Les actions protégées vous demanderont un code. Vous pouvez aussi le saisir maintenant.'}
          </Text>
          {codeField}
        </Stack>
      )}

      {status && !status.enabled && !enrolment && (
        <Stack gap="md">
          <Text>
            Double authentification : <Badge tone="warning">pas activée</Badge>
          </Text>
          <Text tone="secondary">
            Les rôles, la suspension d’un compte, les remboursements et l’annulation d’une commande
            demandent un code à 6 chiffres. Installez une application d’authentification (Google
            Authenticator, Microsoft Authenticator…) sur votre téléphone, puis activez.
          </Text>
          <div>
            <Button onClick={() => void start()} loading={busy}>
              Activer la double authentification
            </Button>
          </div>
        </Stack>
      )}

      {enrolment && (
        <Stack gap="md">
          <Text weight="bold">1. Ajoutez DJAFAT à votre application d’authentification</Text>
          <Text>
            Sur votre téléphone : <a href={enrolment.enrollmentUri}>ouvrir dans l’application</a>.
            Sinon, choisissez « Saisir une clé de configuration » et tapez cette clé :
          </Text>
          <Text as="p" weight="bold">
            <code>{grouped(enrolment.secretBase32)}</code>
          </Text>
          <Text tone="secondary" size="small">
            Cette clé ne s’affiche qu’une fois. Ne la partagez avec personne.
          </Text>
          <Text weight="bold">2. Saisissez le code affiché par l’application</Text>
          {codeField}
        </Stack>
      )}
    </Stack>
  );
}
