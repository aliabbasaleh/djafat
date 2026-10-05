'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type OwnerBalance } from '@djafat/sdk';
import { Heading, Text, Stack, Grid, EmptyState, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Read-only wallet statement (Bloc 10, docs/33 §profile "relevé wallet
 * pending/available, lecture") — `GET /restaurants/me/balance` (Bloc 9,
 * already built for the admin ledger-read surface). `pending` = accrued but
 * not yet settled; `available` = what a payout could draw on today. Neither
 * figure is editable here — this bloc does not touch payouts (docs/14 §14.1
 * exclusions: "payouts automatisés" is V1.x).
 */
export default function WalletPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [balances, setBalances] = useState<readonly OwnerBalance[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await api.restaurant.getBalance();
      setBalances(result);
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

  return (
    <Stack gap="lg">
      <Heading level={1}>Relevé</Heading>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement du relevé">
          <Skeleton height={100} radius="8px" />
        </Stack>
      )}

      {state === 'error' && (
        <ErrorState
          title="Impossible de charger le relevé"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && balances.length === 0 && (
        <EmptyState
          icon="💰"
          title="Aucun solde pour le moment"
          message="Les soldes apparaissent après vos premières commandes livrées."
        />
      )}

      {state === 'ready' && balances.length > 0 && (
        <Grid minItemWidth={240} gap="md">
          {balances.map((b) => (
            <div key={b.currency} className={cx(styles['card'])}>
              <Text size="small" tone="secondary">
                {b.currency}
              </Text>
              <Stack gap="xs">
                <div>
                  <Text size="caption" tone="muted">
                    En attente (pending)
                  </Text>
                  <Text size="body" weight="semibold">
                    {formatMoney(b.pending)}
                  </Text>
                </div>
                <div>
                  <Text size="caption" tone="muted">
                    Disponible (available)
                  </Text>
                  <Text size="body" weight="semibold">
                    {formatMoney(b.available)}
                  </Text>
                </div>
              </Stack>
            </div>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
