'use client';

import { useEffect, useState } from 'react';
import { ApiClientError } from '@djafat/sdk';
import { api } from '@/lib/api';
import styles from './DeliveryCode.module.css';

/**
 * The customer's delivery code (audit finding FE-03). The courier asks for it
 * at the door and cannot finish the delivery without it; the API hands it to
 * the order's customer only, from the courier's pickup until the handover.
 * Rendered by the order page while the order is on its way: the code
 * disappears by itself once the order is delivered (the page stops rendering
 * it) or when the API answers 404 (used or expired).
 */
const REFRESH_MS = 10_000;

export function DeliveryCode({ orderId }: { orderId: string }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let deliveryId: string | null = null;
    const tick = async () => {
      try {
        deliveryId ??= (await api.orders.tracking(orderId)).deliveryId;
        if (!deliveryId) return;
        const res = await api.orders.deliveryCode(deliveryId);
        if (!stop) setCode(res.code);
      } catch (err) {
        // 404: no code yet, already used or expired, so nothing to show.
        // Anything else (network): keep what is on screen.
        if (!stop && err instanceof ApiClientError && err.status === 404) setCode(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [orderId]);

  if (!code) return null;
  return (
    <section className={styles['box']} aria-live="polite" aria-label="Code de livraison">
      <p className={styles['label']}>Votre code de livraison</p>
      <p className={styles['code']}>{code}</p>
      <p className={styles['hint']}>Donnez-le au livreur à son arrivée, et à personne d’autre.</p>
    </section>
  );
}
