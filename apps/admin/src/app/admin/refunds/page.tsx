'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type OpenRefund } from '@djafat/sdk';
import { Heading, Stack, Text, Skeleton, ErrorState, EmptyState, Badge } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { useStepUp } from '@/components/StepUp';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import { StepUpCancelled } from '@/lib/step-up-flow';

const PROVIDER_NAMES: Record<string, string> = {
  airtel_money: 'Airtel Money',
  tigo_cash: 'Tigo Cash',
  moov_money: 'Moov Money',
  mock: 'Test (mock)',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Audit PAY-04: a paid order that ends without delivery is refunded
 * automatically, but Airtel, Tigo and Moov merchant wallets cannot refund by
 * API. Their refunds wait here: send the money back from the merchant phone
 * to the number shown, then record the transfer reference. A refund the
 * provider refused also lands here.
 */
export default function RefundsPage() {
  const router = useRouter();
  const withStepUp = useStepUp();
  const [refunds, setRefunds] = useState<OpenRefund[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setRefunds([...(await api.admin.refunds.listOpen())]);
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

  async function complete(refund: OpenRefund) {
    const providerRef = (refs[refund.id] ?? '').trim();
    setBusyId(refund.id);
    setMessage(null);
    try {
      await withStepUp(() => api.admin.refunds.complete(refund.id, providerRef));
      setMessage({
        tone: 'success',
        text: `Remboursement de la commande ${refund.orderCode ?? refund.orderId} enregistré.`,
      });
      await load();
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      setMessage({
        tone: 'danger',
        text: err instanceof ApiClientError ? err.message : 'Enregistrement impossible.',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack gap="lg">
      <Heading level={1}>Remboursements à faire</Heading>
      <Text tone="secondary">
        Envoyez l’argent depuis le téléphone marchand au numéro indiqué, puis saisissez la référence
        du transfert. L’écriture comptable est passée à l’enregistrement.
      </Text>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {loadError && (
        <ErrorState
          title="Impossible de charger les remboursements"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      )}
      {!refunds && !loadError && <Skeleton height={160} radius="8px" />}
      {refunds?.length === 0 && (
        <EmptyState icon="✅" title="Aucun remboursement en attente" message="Tout est à jour." />
      )}

      {refunds?.map((refund) => (
        <Stack key={refund.id} gap="sm">
          <Text weight="bold">
            {formatMoney(refund.amount)} — commande {refund.orderCode ?? refund.orderId}{' '}
            <Badge tone={refund.status === 'failed' ? 'danger' : 'warning'}>
              {refund.status === 'failed' ? 'refusé par le fournisseur' : 'à envoyer'}
            </Badge>
          </Text>
          <Text size="small">
            {PROVIDER_NAMES[refund.providerCode] ?? refund.providerCode}
            {refund.payerPhone ? ` · payé depuis le ${refund.payerPhone}` : ''} ·{' '}
            {formatDate(refund.createdAt)}
          </Text>
          <Text size="small" tone="secondary">
            {refund.reason}
            {refund.lastError ? ` (erreur : ${refund.lastError})` : ''}
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void complete(refund);
            }}
          >
            <Stack gap="sm">
              <Input
                label="Référence du transfert"
                value={refs[refund.id] ?? ''}
                onChange={(e) => setRefs((r) => ({ ...r, [refund.id]: e.target.value }))}
              />
              <div>
                <Button
                  type="submit"
                  loading={busyId === refund.id}
                  disabled={!/^[A-Za-z0-9._-]{4,64}$/.test((refs[refund.id] ?? '').trim())}
                >
                  Marquer comme envoyé
                </Button>
              </div>
            </Stack>
          </form>
        </Stack>
      ))}
    </Stack>
  );
}
