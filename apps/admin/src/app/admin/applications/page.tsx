'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type ApplicationType, type ApplicationsQueue } from '@djafat/sdk';
import { Heading, Stack, EmptyState, ErrorState, Skeleton, Text, cx } from '@djafat/ui';
import { Button, Tabs } from '@/components/ui-client';
import { DataTable } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { sentOn } from '@/lib/applications';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';

function typeFromUrl(): ApplicationType {
  return new URLSearchParams(window.location.search).get('type') === 'courier'
    ? 'courier'
    : 'restaurant';
}

/**
 * FEAT-022 (SPEC-022-07 R1, FEAT-022-VIS06): « Demandes à vérifier » — the
 * applications sent to DJAFAT, oldest first, in two tabs that show their
 * number. Admins only (the entry is hidden for support and finance, and the
 * API refuses them).
 */
export default function ApplicationsPage() {
  const router = useRouter();
  const [type, setType] = useState<ApplicationType>('restaurant');
  const [state, setState] = useState<LoadState>('loading');
  const [queue, setQueue] = useState<ApplicationsQueue | null>(null);

  const load = useCallback(
    async (t: ApplicationType) => {
      setState('loading');
      try {
        setQueue(await api.admin.applications.list(t));
        setState('ready');
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          clearSession();
          router.replace('/login');
          return;
        }
        setState('error');
      }
    },
    [router],
  );

  useEffect(() => {
    const initial = typeFromUrl();
    setType(initial);
    void load(initial);
  }, [load]);

  function choose(id: string) {
    const next: ApplicationType = id === 'courier' ? 'courier' : 'restaurant';
    setType(next);
    window.history.replaceState(null, '', `/admin/applications?type=${next}`);
    void load(next);
  }

  const counts = queue?.counts;
  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Demandes à vérifier</Heading>
      </div>

      <Tabs
        aria-label="Type de demande"
        activeId={type}
        onChange={choose}
        items={[
          {
            id: 'restaurant',
            label: counts ? `Restaurants (${counts.restaurant})` : 'Restaurants',
          },
          { id: 'courier', label: counts ? `Livreurs (${counts.courier})` : 'Livreurs' },
        ]}
      />

      <div role="tabpanel" id={`tabpanel-${type}`} aria-labelledby={`tab-${type}`}>
        {state === 'loading' && (
          <Stack gap="sm" aria-busy="true" aria-label="Chargement des demandes">
            <Skeleton height={40} />
            <Skeleton height={160} radius="8px" />
          </Stack>
        )}

        {state === 'error' && (
          <ErrorState
            title="Impossible de charger les demandes"
            action={<Button onClick={() => void load(type)}>Réessayer</Button>}
          />
        )}

        {state === 'ready' && queue && queue.items.length === 0 && (
          <EmptyState
            icon="✅"
            title={type === 'courier' ? 'Aucun livreur à vérifier' : 'Aucun restaurant à vérifier'}
          />
        )}

        {state === 'ready' && queue && queue.items.length > 0 && (
          <Stack gap="sm">
            <Text tone="muted" size="small">
              Les plus anciennes d’abord.
            </Text>
            <DataTable
              keyFor={(row) => row.id}
              rows={queue.items}
              columns={[
                { header: 'Nom', render: (row) => row.name ?? '—' },
                { header: 'Quartier', render: (row) => row.neighbourhood ?? '—' },
                { header: 'Envoi', render: (row) => sentOn(row.submittedAt) },
                {
                  header: '',
                  render: (row) =>
                    type === 'courier' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        href={`/admin/applications/courier/${row.id}`}
                      >
                        Ouvrir
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Stack>
        )}
      </div>
    </Stack>
  );
}
