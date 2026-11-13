'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, type DoorPanel } from '@djafat/sdk';
import { cx } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { getStoredUser } from '@/lib/auth-storage';
import styles from './PaymentPicker.module.css';

const WALLET_NAMES: Record<string, string> = {
  airtel_money: 'Airtel Money',
  tigo_cash: 'Tigo Cash',
};
const walletName = (code: string) => WALLET_NAMES[code] ?? code;

/**
 * Pay-on-delivery order, courier on the way: the customer either gives cash
 * to the courier (the courier validates it in his app), or pays by Airtel
 * Money / Tigo Cash right now and types the transaction number here. The
 * payment is checked against what DJAFAT really received — never a screenshot.
 */
export function DoorPayment({ orderId }: { orderId: string }) {
  const [panel, setPanel] = useState<DoorPanel | null>(null);
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [payerPhone, setPayerPhone] = useState(getStoredUser()?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.payments.doorForOrder(orderId);
      setPanel(p);
      setWallet((w) => w ?? p.wallets[0]?.providerCode ?? null);
    } catch {
      setPanel(null);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Waiting for DJAFAT to see the transfer: re-check every 5 s.
  useEffect(() => {
    if (!waiting || panel?.paidByTransfer) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [waiting, panel?.paidByTransfer, load]);

  if (!panel || !panel.paymentId) return null;

  if (panel.paidByTransfer) {
    return (
      <Alert tone="success">
        Payé par mobile money — vous n&apos;avez rien à donner au livreur.
      </Alert>
    );
  }
  if (panel.wallets.length === 0) return null;

  const paymentId = panel.paymentId;
  const selected = panel.wallets.find((w) => w.providerCode === wallet) ?? panel.wallets[0]!;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.payments.payAtDoor(paymentId, {
        providerCode: selected.providerCode,
        ...(ref.trim() ? { transactionRef: ref.trim() } : {}),
        ...(payerPhone.trim() ? { payerPhone: payerPhone.trim() } : {}),
      });
      if (res.outcome === 'paid') {
        setWaiting(false);
        await load();
      } else if (res.outcome === 'amount_mismatch') {
        setError('Le montant reçu ne correspond pas au total. Contactez le support DJAFAT.');
      } else {
        setWaiting(true);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Vérification impossible pour le moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className={cx(styles['card'])}>
        <p className={cx(styles['heading'])}>💵 Paiement à la livraison</p>
        <p className={cx(styles['muted'])}>
          Donnez les espèces au livreur, ou payez maintenant par mobile money.
        </p>
        <Button fullWidth variant="secondary" onClick={() => setOpen(true)}>
          📱 Payer par {panel.wallets.map((w) => walletName(w.providerCode)).join(' / ')}
        </Button>
      </section>
    );
  }

  return (
    <section className={cx(styles['card'])}>
      <p className={cx(styles['heading'])}>📱 Payer par {walletName(selected.providerCode)}</p>
      {panel.wallets.length > 1 && (
        <div className={cx(styles['options'])} role="radiogroup" aria-label="Portefeuille">
          {panel.wallets.map((w) => (
            <button
              key={w.providerCode}
              type="button"
              role="radio"
              aria-checked={w.providerCode === selected.providerCode}
              className={cx(
                styles['option'],
                w.providerCode === selected.providerCode && styles['selected'],
              )}
              onClick={() => setWallet(w.providerCode)}
            >
              <span className={cx(styles['optionName'])}>{walletName(w.providerCode)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={cx(styles['instructions'])}>{selected.instructions}</div>
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
      {waiting && (
        <Alert tone="info">
          Vérification en cours : dès que DJAFAT voit votre transfert, le livreur est prévenu. Cette
          page se met à jour toute seule.
        </Alert>
      )}
      <Button fullWidth onClick={() => void submit()} disabled={busy}>
        {busy ? 'Vérification…' : "J'ai payé"}
      </Button>
      <Button fullWidth variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
        Je paie plutôt en espèces
      </Button>
    </section>
  );
}
