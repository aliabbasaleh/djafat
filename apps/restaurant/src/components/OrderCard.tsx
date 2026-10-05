'use client';

import { useState } from 'react';
import { Badge, Stack, Inline, Text, cx } from '@djafat/ui';
import type { RestaurantOrderSummary } from '@djafat/sdk';
import { Button } from '@/components/ui-client';
import { formatMoney, formatElapsed } from '@/lib/format';
import { statusLabel, statusTone } from '@/lib/order-status';
import styles from './OrderCard.module.css';

export interface OrderCardProps {
  readonly order: RestaurantOrderSummary;
  readonly onConfirm?: (orderId: string) => Promise<void>;
  readonly onReject?: (orderId: string, reason: string) => Promise<void>;
  readonly onReady?: (orderId: string) => Promise<void>;
}

/**
 * One order on the board (Bloc 10, docs/33 §order-board). Actions are
 * intentionally the only mutation surface — a card never lets staff edit the
 * order itself (items/total are a frozen snapshot, docs/22 §9). Reject asks
 * for a reason inline (a `<details>`/textarea toggle) rather than a browser
 * `prompt()`, which Playwright/jsdom cannot drive and some kiosks block.
 */
export function OrderCard({ order, onConfirm, onReject, onReady }: OrderCardProps) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={cx(styles['card'])} aria-label={`Commande ${order.code}`}>
      <Inline justify="between" align="center">
        <Text weight="semibold">{order.code}</Text>
        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
      </Inline>
      <Text size="small" tone="secondary">
        {formatElapsed(order.placedAt ?? order.createdAt)}
      </Text>

      <ul className={cx(styles['itemList'])}>
        {order.items.map((item, i) => (
          <li key={i} className={cx(styles['itemRow'])}>
            <Text size="small">
              {item.quantity}× {item.name}
              {item.options.length > 0 && (
                <Text as="span" size="caption" tone="muted" className={cx(styles['optionNote'])}>
                  {item.options.join(', ')}
                </Text>
              )}
            </Text>
          </li>
        ))}
      </ul>

      <Inline justify="between">
        <Text size="small" tone="secondary">
          Total
        </Text>
        <Text weight="semibold">{formatMoney(order.total)}</Text>
      </Inline>

      {order.status === 'placed' && onConfirm && onReject && (
        <Stack gap="sm">
          {!rejecting ? (
            <div className={cx(styles['actions'])}>
              <Button size="sm" disabled={busy} onClick={() => void run(() => onConfirm(order.id))}>
                Accepter
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
                Refuser
              </Button>
            </div>
          ) : (
            <Stack gap="sm">
              <textarea
                className={cx(styles['reasonInput'])}
                placeholder="Motif du refus (optionnel)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
              <div className={cx(styles['actions'])}>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void run(() => onReject(order.id, reason))}
                >
                  Confirmer le refus
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                >
                  Annuler
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
      )}

      {(order.status === 'confirmed' || order.status === 'preparing') && onReady && (
        <Button size="sm" disabled={busy} onClick={() => void run(() => onReady(order.id))}>
          Marquer prête
        </Button>
      )}

      {order.status === 'ready' && (
        <Text size="small" tone="secondary">
          En attente du livreur…
        </Text>
      )}

      {['courier_assigned', 'picked_up', 'on_the_way'].includes(order.status) && (
        <Text size="small" tone="secondary">
          En livraison…
        </Text>
      )}
    </article>
  );
}
