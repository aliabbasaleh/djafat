'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type FinanceBalances, type Settlement } from '@djafat/sdk';
import { Heading, Text, Stack, ErrorState, Skeleton, Alert, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { DataTable } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
}

/**
 * Read-only financial overview (Bloc 9, docs/30 §finance-admin-ux). No
 * mutation is possible from this page — balances come straight from
 * `LedgerReadService` (never the write engine), and the payout section is
 * explicitly labelled unavailable rather than a non-functional button
 * pretending otherwise (mandate: "NE PAS créer de faux bouton payout").
 */
export default function AdminFinancePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [balances, setBalances] = useState<FinanceBalances | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [bal, settle] = await Promise.all([
        api.admin.finance.balances(),
        api.admin.finance.settlements(),
      ]);
      setBalances(bal);
      setSettlements([...settle]);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <Stack gap="md" aria-busy="true" aria-label="Chargement des finances">
        <Skeleton width={200} height={28} />
        <Skeleton height={160} radius="8px" />
      </Stack>
    );
  }

  if (state === 'error' || !balances) {
    return (
      <ErrorState
        title="Impossible de charger les données financières"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Heading level={1}>Finance</Heading>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Soldes restaurants (total)</Text>
        {balances.restaurantTotals.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucune donnée.
          </Text>
        ) : (
          <DataTable
            keyFor={(r) => r.currency}
            rows={balances.restaurantTotals}
            columns={[
              { header: 'Devise', render: (r) => r.currency },
              { header: 'En attente', render: (r) => formatMoney(r.totalPending) },
              { header: 'Disponible', render: (r) => formatMoney(r.totalAvailable) },
            ]}
          />
        )}
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Soldes livreurs (total)</Text>
        {balances.courierTotals.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucune donnée.
          </Text>
        ) : (
          <DataTable
            keyFor={(r) => r.currency}
            rows={balances.courierTotals}
            columns={[
              { header: 'Devise', render: (r) => r.currency },
              { header: 'En attente', render: (r) => formatMoney(r.totalPending) },
              { header: 'Disponible', render: (r) => formatMoney(r.totalAvailable) },
            ]}
          />
        )}
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Comptes DJAFAT</Text>
        {balances.globalAccounts.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucune donnée.
          </Text>
        ) : (
          <DataTable
            keyFor={(a) => a.code}
            rows={balances.globalAccounts}
            columns={[
              { header: 'Compte', render: (a) => a.code },
              { header: 'Devise', render: (a) => a.currency },
              { header: 'Solde', render: (a) => formatMoney(a.balance) },
            ]}
          />
        )}
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Règlements (settlements)</Text>
        {settlements.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucun règlement enregistré.
          </Text>
        ) : (
          <DataTable
            keyFor={(s) => s.id}
            rows={settlements}
            columns={[
              { header: 'Fournisseur', render: (s) => s.providerCode },
              {
                header: 'Période',
                render: (s) => `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`,
              },
              { header: 'Net', render: (s) => formatMoney(s.net) },
              { header: 'Statut', render: (s) => s.status },
            ]}
          />
        )}
      </div>

      <Alert tone="info" title="Virements (payouts)">
        Non disponible dans cette version — le versement réel vers les restaurants et livreurs sera
        un bloc financier séparé. Le grand livre reste la source de vérité des montants dus.
      </Alert>
    </Stack>
  );
}
