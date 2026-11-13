'use client';

import { useEffect, useState } from 'react';
import { ApiClientError, type PaymentMethodOption, type Payment } from '@djafat/sdk';
import { cx } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { getStoredUser } from '@/lib/auth-storage';
import styles from './PaymentPicker.module.css';

/**
 * Payment step of an order awaiting payment (FEAT-009 backend):
 * - cash on delivery: one tap, the order goes to the restaurant;
 * - mobile money (Airtel Money, Tigo Cash) to DJAFAT's merchant number: the
 *   instructions are shown, the customer gives the transaction number from
 *   the operator SMS, and the payment is checked against what DJAFAT really
 *   received — never a screenshot.
 */
const ICONS: Record<string, string> = {
  cash: '💵',
  airtel_money: '📱',
  tigo_cash: '📱',
  mock: '🧪',
};

export function PaymentPicker({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const [methods, setMethods] = useState<PaymentMethodOption[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [ref, setRef] = useState('');
  const [payerPhone, setPayerPhone] = useState(getStoredUser()?.phone ?? '');
  const [claimInfo, setClaimInfo] = useState<string | null>(null);

  useEffect(() => {
    api.payments
      .methodsForOrder(orderId)
      .then((list) => {
        const usable = list.filter((m) => m.providerCode !== 'mock');
        setMethods(usable);
        setChoice(usable[0]?.providerCode ?? null);
      })
      .catch(() => setMethods([]));
  }, [orderId]);

  const selected = methods?.find((m) => m.providerCode === choice) ?? null;

  async function pay() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.payments.create(crypto.randomUUID(), {
        orderId,
        providerCode: selected.providerCode,
        methodCode: selected.methodCode,
        ...(selected.capabilities.requiresPayerPhone && payerPhone ? { payerPhone } : {}),
      });
      if (selected.capabilities.matchedByTransferReceipt) {
        setPayment(res.payment); // show instructions + transaction number form
      } else {
        onChanged(); // cash: the order is placed right away
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Le paiement a échoué, réessayez dans un instant.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.payments.claimTransfer(payment.id, {
        ...(ref.trim() ? { transactionRef: ref.trim() } : {}),
        ...(payerPhone.trim() ? { payerPhone: payerPhone.trim() } : {}),
      });
      if (res.outcome === 'paid') {
        setClaimInfo(null);
        onChanged();
      } else if (res.outcome === 'amount_mismatch') {
        setError('Le montant reçu ne correspond pas au total. Contactez le support DJAFAT.');
      } else {
        setClaimInfo(
          'Vérification en cours : votre commande partira au restaurant dès que DJAFAT aura reçu le transfert. Cette page se met à jour toute seule.',
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Vérification impossible pour le moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (methods === null)
    return <p className={cx(styles['muted'])}>Chargement des moyens de paiement…</p>;
  if (methods.length === 0) {
    return <Alert tone="danger">Aucun moyen de paiement disponible pour cette commande.</Alert>;
  }

  if (payment) {
    return (
      <section className={cx(styles['card'])}>
        <p className={cx(styles['heading'])}>📱 Payer avec {selected?.displayName}</p>
        <div className={cx(styles['instructions'])}>{payment.action?.instructions}</div>
        <Input
          label="Numéro de transaction (dans le SMS de l'opérateur)"
          placeholder="ex. CI251107.1432.A81234"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <Input
          label="Numéro qui a payé"
          helpText="Si vous avez payé depuis un autre téléphone, indiquez ce numéro."
          value={payerPhone}
          onChange={(e) => setPayerPhone(e.target.value)}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {claimInfo && <Alert tone="info">{claimInfo}</Alert>}
        <Button fullWidth onClick={() => void claim()} disabled={busy}>
          {busy ? 'Vérification…' : "J'ai payé"}
        </Button>
      </section>
    );
  }

  return (
    <section className={cx(styles['card'])}>
      <p className={cx(styles['heading'])}>Comment voulez-vous payer ?</p>
      <div className={cx(styles['options'])} role="radiogroup" aria-label="Moyen de paiement">
        {methods.map((m) => (
          <button
            key={m.providerCode}
            type="button"
            role="radio"
            aria-checked={choice === m.providerCode}
            className={cx(styles['option'], choice === m.providerCode && styles['selected'])}
            onClick={() => setChoice(m.providerCode)}
          >
            <span className={cx(styles['optionIcon'])} aria-hidden="true">
              {ICONS[m.providerCode] ?? '💳'}
            </span>
            <span>
              <span className={cx(styles['optionName'])}>
                {m.capabilities.collectedOnDelivery ? 'Espèces à la livraison' : m.displayName}
              </span>
              <span className={cx(styles['optionHint'])}>
                {m.capabilities.collectedOnDelivery
                  ? 'Vous payez le livreur à la réception'
                  : 'Paiement maintenant, au numéro marchand DJAFAT'}
              </span>
            </span>
          </button>
        ))}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button fullWidth onClick={() => void pay()} disabled={busy || !selected}>
        {busy
          ? 'Un instant…'
          : selected?.capabilities.collectedOnDelivery
            ? 'Confirmer la commande'
            : 'Continuer'}
      </Button>
    </section>
  );
}
