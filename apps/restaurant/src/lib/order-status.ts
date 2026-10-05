import type { BadgeTone } from '@djafat/ui';

/** French labels + badge tone for every `OrderStatus` the restaurant app ever displays (docs/33 §order-board). Kept here, not duplicated per page. */
const STATUS_INFO: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  awaiting_payment: { label: 'En attente de paiement', tone: 'neutral' },
  placed: { label: 'Nouvelle', tone: 'info' },
  confirmed: { label: 'Acceptée', tone: 'info' },
  preparing: { label: 'En préparation', tone: 'warning' },
  ready: { label: 'Prête', tone: 'success' },
  courier_assigned: { label: 'Livreur en route', tone: 'info' },
  picked_up: { label: 'Récupérée', tone: 'info' },
  on_the_way: { label: 'En livraison', tone: 'info' },
  delivered: { label: 'Livrée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  rejected: { label: 'Refusée', tone: 'danger' },
  expired: { label: 'Expirée', tone: 'neutral' },
};

export function statusLabel(status: string): string {
  return STATUS_INFO[status]?.label ?? status;
}

export function statusTone(status: string): BadgeTone {
  return STATUS_INFO[status]?.tone ?? 'neutral';
}
