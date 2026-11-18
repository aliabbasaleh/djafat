'use client';

import { useState } from 'react';
import { ApiClientError, type OrderStatus } from '@djafat/sdk';
import { Alert, Button } from '@/components/ui-client';
import { api } from '@/lib/api';

/** The statuses from which the customer may cancel (ORD-01, the order state machine). */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  'awaiting_payment',
  'placed',
  'confirmed',
];

/**
 * "Annuler la commande" (ORD-01): offered until the restaurant starts
 * cooking, behind a second click. A paid order is refunded automatically
 * (PAY-04); the page says so once the order is cancelled. If the restaurant
 * moved on in between, the API answers 409 and the page reloads the order.
 */
export function CancelOrder({
  orderId,
  status,
  onChanged,
}: {
  orderId: string;
  status: OrderStatus;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!CUSTOMER_CANCELLABLE.includes(status)) return null;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.orders.cancel(orderId);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.status === 409
          ? 'Le restaurant a déjà commencé à préparer votre commande : elle ne peut plus être annulée.'
          : "L'annulation n'a pas abouti. Réessayez dans un instant.",
      );
      setConfirming(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {confirming ? (
        <>
          <Alert tone="warning">
            Annuler cette commande ? Si vous l&apos;avez déjà payée, vous serez remboursé.
          </Alert>
          <Button variant="danger" fullWidth loading={busy} onClick={() => void cancel()}>
            Oui, annuler la commande
          </Button>
          <Button
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Non, garder ma commande
          </Button>
        </>
      ) : (
        <Button variant="ghost" fullWidth onClick={() => setConfirming(true)}>
          Annuler la commande
        </Button>
      )}
    </>
  );
}
