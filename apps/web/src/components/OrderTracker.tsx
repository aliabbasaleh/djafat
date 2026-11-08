import type { OrderStatus } from '@djafat/sdk';
import { cx } from '@djafat/ui';
import styles from './OrderTracker.module.css';

/**
 * Large, readable order tracking for the customer: one big current step
 * (icon + title + explanation) and a 5-step progress bar. Replaces the small
 * status badge, which customers found too hard to see.
 */
const STEPS = [
  { key: 'received', label: 'Reçue' },
  { key: 'accepted', label: 'Acceptée' },
  { key: 'ready', label: 'Prête' },
  { key: 'onTheWay', label: 'En route' },
  { key: 'delivered', label: 'Livrée' },
] as const;

const STEP_OF: Partial<Record<OrderStatus, number>> = {
  placed: 0,
  confirmed: 1,
  preparing: 1,
  ready: 2,
  courier_assigned: 3,
  picked_up: 3,
  on_the_way: 3,
  delivered: 4,
};

const CURRENT: Record<OrderStatus, { icon: string; title: string; detail: string }> = {
  draft: { icon: '📝', title: 'Brouillon', detail: '' },
  awaiting_payment: {
    icon: '💳',
    title: 'Choisissez comment payer',
    detail: 'Votre commande part au restaurant dès que le paiement est choisi.',
  },
  placed: {
    icon: '📨',
    title: 'Commande reçue',
    detail: 'Le restaurant va confirmer votre commande.',
  },
  confirmed: {
    icon: '👨‍🍳',
    title: 'Le restaurant a accepté',
    detail: 'Votre repas va être préparé.',
  },
  preparing: { icon: '🍳', title: 'En préparation', detail: 'Le restaurant prépare votre repas.' },
  ready: {
    icon: '🛍️',
    title: 'Votre commande est prête',
    detail: 'Nous cherchons un livreur près du restaurant.',
  },
  courier_assigned: {
    icon: '🛵',
    title: 'Un livreur arrive au restaurant',
    detail: 'Il va récupérer votre commande.',
  },
  picked_up: {
    icon: '🛵',
    title: 'Le livreur a votre commande',
    detail: 'Il part vers chez vous.',
  },
  on_the_way: {
    icon: '🛵',
    title: 'Le livreur est en route',
    detail: 'Préparez votre code de livraison : donnez-le au livreur à son arrivée.',
  },
  delivered: { icon: '✅', title: 'Livrée', detail: 'Bon appétit !' },
  cancelled: { icon: '✖️', title: 'Commande annulée', detail: '' },
  rejected: {
    icon: '✖️',
    title: 'Le restaurant a refusé la commande',
    detail: 'Vous ne serez pas débité.',
  },
  expired: {
    icon: '⌛',
    title: 'Commande expirée',
    detail: "Le paiement n'a pas été fait à temps.",
  },
};

export function OrderTracker({ status }: { status: OrderStatus }) {
  const step = STEP_OF[status];
  const current = CURRENT[status];
  const tone =
    status === 'delivered'
      ? 'success'
      : ['cancelled', 'rejected', 'expired'].includes(status)
        ? 'danger'
        : 'active';
  return (
    <section className={cx(styles['tracker'], styles[tone])} aria-live="polite">
      <div className={cx(styles['current'])}>
        <span className={cx(styles['icon'])} aria-hidden="true">
          {current.icon}
        </span>
        <div>
          <p className={cx(styles['title'])}>{current.title}</p>
          {current.detail && <p className={cx(styles['detail'])}>{current.detail}</p>}
        </div>
      </div>
      {step !== undefined && (
        <ol className={cx(styles['steps'])} aria-label="Étapes de la commande">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={cx(
                styles['step'],
                i <= step && styles['done'],
                i === step && styles['now'],
              )}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className={cx(styles['dot'])} />
              <span className={cx(styles['stepLabel'])}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
