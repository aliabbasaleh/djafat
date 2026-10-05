'use client';

import { Heading, Text, cx } from '@djafat/ui';
import type { RestaurantOrderSummary } from '@djafat/sdk';
import { OrderCard } from './OrderCard';
import styles from './OrderBoard.module.css';

export interface OrderBoardProps {
  readonly orders: readonly RestaurantOrderSummary[];
  readonly onConfirm: (orderId: string) => Promise<void>;
  readonly onReject: (orderId: string, reason: string) => Promise<void>;
  readonly onReady: (orderId: string) => Promise<void>;
}

interface Column {
  readonly title: string;
  readonly statuses: readonly string[];
}

const COLUMNS: readonly Column[] = [
  { title: 'Nouvelles', statuses: ['placed'] },
  { title: 'En préparation', statuses: ['confirmed', 'preparing'] },
  { title: 'Prêtes', statuses: ['ready'] },
  { title: 'En livraison', statuses: ['courier_assigned', 'picked_up', 'on_the_way'] },
];

/** The kitchen's order board (Bloc 10, docs/33 §order-board) — 4 columns on `lg`+, stacked sections below. Oldest first within each column (`listOrdersForRestaurant` already sorts that way — this never re-sorts). */
export function OrderBoard({ orders, onConfirm, onReject, onReady }: OrderBoardProps) {
  return (
    <div className={cx(styles['board'])}>
      {COLUMNS.map((column) => {
        const items = orders.filter((o) => column.statuses.includes(o.status));
        return (
          <section key={column.title} className={cx(styles['column'])} aria-label={column.title}>
            <div className={cx(styles['columnHeader'])}>
              <Heading level={2} size="h3">
                {column.title}
              </Heading>
              <Text size="small" tone="secondary">
                {items.length}
              </Text>
            </div>
            <div className={cx(styles['cardList'])}>
              {items.length === 0 && (
                <Text size="small" tone="muted">
                  Aucune commande
                </Text>
              )}
              {items.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onConfirm={onConfirm}
                  onReject={onReject}
                  onReady={onReady}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
