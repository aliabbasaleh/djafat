'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, mobileMoneyText, type CourierPayout, type MobileMoney } from '@djafat/sdk';
import { Heading, Stack, Text, cx } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import styles from '../phone-order/page.module.css';

type StaffPayout = CourierPayout & {
  readonly courier: {
    id: string;
    name: string | null;
    phone: string | null;
    /** FEAT-022 (SPEC-022-07 R6): the number DJAFAT approved — never one still waiting. */
    mobileMoney: MobileMoney | null;
  };
};

/**
 * FEAT-014 — courier payouts to send by Airtel Money. The team prepares the
 * Monday payouts, sends each amount to the courier's number, then records the
 * operator's transaction number and fee: only then does money move in the
 * ledger (cash owed settled first, the rest paid).
 */
export default function PayoutsPage() {
  const [rows, setRows] = useState<readonly StaffPayout[] | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [fees, setFees] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.admin.payouts.list('requested'));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function prepareWeekly() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.admin.payouts.prepareWeekly();
      setInfo(`${r.created} versement(s) de la semaine préparé(s).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Préparation impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function markSent(p: StaffPayout) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.admin.payouts.markSent(p.id, {
        transactionRef: (refs[p.id] ?? '').trim(),
        airtelFeeMinor: Number(fees[p.id] || 0),
      });
      setInfo(
        r.status === 'sent'
          ? `Versement enregistré : ${formatMoney(r.received!)} reçus par ${p.courier.name ?? p.courier.phone}.`
          : 'Plus rien à verser à ce livreur : versement annulé.',
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg" className={cx(styles['page'])}>
      <Heading level={1}>Versements livreurs</Heading>
      <Text tone="secondary">
        Envoyez chaque montant par Airtel Money au numéro du livreur, puis saisissez le numéro de
        transaction et les frais Airtel. Les espèces que le livreur doit sont soldées
        automatiquement.
      </Text>
      <Button onClick={() => void prepareWeekly()} disabled={busy} variant="secondary">
        Préparer les versements du lundi
      </Button>
      {info && <Alert tone="success">{info}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {rows === null && <Text>Chargement…</Text>}
      {rows?.length === 0 && <Text tone="secondary">Aucun versement à envoyer.</Text>}
      {rows?.map((p) => (
        <section key={p.id} className={cx(styles['card'])} aria-label={`Versement ${p.id}`}>
          <Text weight="bold">
            {p.courier.name ?? 'Livreur'} ·{' '}
            {p.courier.mobileMoney ? mobileMoneyText(p.courier.mobileMoney) : p.courier.phone} ·{' '}
            {formatMoney(p.requested)}
          </Text>
          <Text size="small" tone="secondary">
            {p.kind === 'weekly'
              ? 'Versement du lundi — frais Airtel payés par DJAFAT'
              : 'Retrait à la demande — frais Airtel à la charge du livreur'}
          </Text>
          <div className={cx(styles['row'])}>
            <Input
              label="Numéro de transaction Airtel"
              value={refs[p.id] ?? ''}
              onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })}
            />
            <Input
              label="Frais Airtel (FCFA)"
              inputMode="numeric"
              value={fees[p.id] ?? ''}
              onChange={(e) => setFees({ ...fees, [p.id]: e.target.value })}
            />
          </div>
          <Button onClick={() => void markSent(p)} disabled={busy || !(refs[p.id] ?? '').trim()}>
            Marquer envoyé
          </Button>
        </section>
      ))}
    </Stack>
  );
}
