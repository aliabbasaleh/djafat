'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiClientError, type AdminUserDetail, type AdminRestaurantSummary } from '@djafat/sdk';
import type { Role } from '@djafat/types';
import { Heading, Text, Stack, Badge, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Select, Alert } from '@/components/ui-client';
import { useStepUp } from '@/components/StepUp';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { StepUpCancelled } from '@/lib/step-up-flow';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error' | 'not-found';

const ROLE_LABELS: Record<Role, string> = {
  customer: 'Client',
  restaurant_owner: 'Propriétaire restaurant',
  restaurant_staff: 'Staff restaurant',
  courier: 'Livreur',
  support: 'Support',
  finance: 'Finance',
  admin: 'Admin',
  super_admin: 'Super admin',
};
const RESTAURANT_SCOPED: ReadonlySet<Role> = new Set(['restaurant_owner', 'restaurant_staff']);
const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = params.id;
  // ADM-03: role changes and account status need a recent MFA step-up;
  // `withStepUp` asks for the TOTP code when the API answers 428.
  const withStepUp = useStepUp();

  const [state, setState] = useState<LoadState>('loading');
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [restaurants, setRestaurants] = useState<AdminRestaurantSummary[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [grantRole, setGrantRole] = useState<Role>('courier');
  const [grantRestaurantId, setGrantRestaurantId] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [detail, restaurantList] = await Promise.all([
        api.admin.users.get(userId),
        api.admin.restaurants.list({ limit: 50 }),
      ]);
      setUser(detail);
      setRestaurants([...restaurantList.items]);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      if (err instanceof ApiClientError && err.status === 404) {
        setState('not-found');
        return;
      }
      setState('error');
    }
  }, [userId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGrant() {
    setActionError(null);
    setBusy(true);
    try {
      const scopeRestaurantId = RESTAURANT_SCOPED.has(grantRole) ? grantRestaurantId : undefined;
      if (RESTAURANT_SCOPED.has(grantRole) && !scopeRestaurantId) {
        setActionError('Sélectionnez un restaurant pour ce rôle.');
        return;
      }
      await withStepUp(() => api.admin.users.grantRole(userId, grantRole, scopeRestaurantId));
      await load();
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      setActionError(
        err instanceof ApiClientError ? err.message : 'Impossible d’attribuer ce rôle.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(role: Role, scopeRestaurantId: string | null) {
    const label = ROLE_LABELS[role];
    if (!window.confirm(`Révoquer le rôle "${label}" pour cet utilisateur ?`)) return;
    setActionError(null);
    setBusy(true);
    try {
      await withStepUp(() =>
        api.admin.users.revokeRole(userId, role, scopeRestaurantId ?? undefined),
      );
      await load();
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      setActionError(
        err instanceof ApiClientError ? err.message : 'Impossible de révoquer ce rôle.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLifecycle(action: 'suspend' | 'block' | 'reactivate') {
    const verbs = { suspend: 'suspendre', block: 'bloquer', reactivate: 'réactiver' };
    if (!window.confirm(`Confirmez-vous vouloir ${verbs[action]} ce compte ?`)) return;
    let reason = '';
    if (action !== 'reactivate') {
      const entered = window.prompt('Raison (obligatoire) :');
      if (!entered || !entered.trim()) return;
      reason = entered.trim();
    } else {
      reason = 'Réactivation administrative';
    }
    setActionError(null);
    setBusy(true);
    try {
      await withStepUp(() => api.admin.users[action](userId, reason));
      await load();
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      setActionError(err instanceof ApiClientError ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  function restaurantName(id: string | null): string {
    if (!id) return '—';
    return restaurants.find((r) => r.id === id)?.name ?? id;
  }

  if (state === 'loading') {
    return (
      <Stack gap="md" aria-busy="true" aria-label="Chargement du profil">
        <Skeleton width={240} height={28} />
        <Skeleton height={120} radius="8px" />
      </Stack>
    );
  }

  if (state === 'not-found') {
    return <ErrorState title="Utilisateur introuvable" />;
  }

  if (state === 'error' || !user) {
    return (
      <ErrorState
        title="Impossible de charger ce profil"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>{user.fullName ?? user.phone}</Heading>
        <Text tone="secondary">
          {user.phone} — statut : <strong>{user.status}</strong> — créé le{' '}
          {formatDate(user.createdAt)}
        </Text>
      </Stack>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <div className={cx(styles['section'])}>
        <Text weight="bold">Compte</Text>
        <div className={cx(styles['actions'])}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || user.status === 'suspended'}
            onClick={() => void handleLifecycle('suspend')}
          >
            Suspendre
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || user.status === 'blocked'}
            onClick={() => void handleLifecycle('block')}
          >
            Bloquer
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || user.status === 'active'}
            onClick={() => void handleLifecycle('reactivate')}
          >
            Réactiver
          </Button>
        </div>
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Rôles actuels</Text>
        {user.roles.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucun rôle.
          </Text>
        ) : (
          <ul className={cx(styles['roleList'])}>
            {user.roles.map((grant) => (
              <li
                key={`${grant.role}:${grant.scopeRestaurantId ?? 'global'}`}
                className={cx(styles['roleRow'])}
              >
                <Badge tone="info">{ROLE_LABELS[grant.role]}</Badge>
                <Text size="small" tone="secondary">
                  {grant.scopeRestaurantId
                    ? restaurantName(grant.scopeRestaurantId)
                    : 'Portée globale'}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleRevoke(grant.role, grant.scopeRestaurantId)}
                >
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Attribuer un rôle</Text>
        <form
          className={cx(styles['grantForm'])}
          onSubmit={(e) => {
            e.preventDefault();
            void handleGrant();
          }}
        >
          <Select
            label="Rôle"
            value={grantRole}
            onChange={(e) => setGrantRole(e.target.value as Role)}
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          {RESTAURANT_SCOPED.has(grantRole) && (
            <Select
              label="Restaurant"
              value={grantRestaurantId}
              onChange={(e) => setGrantRestaurantId(e.target.value)}
              required
            >
              <option value="">— Choisir —</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" loading={busy}>
            Attribuer
          </Button>
        </form>
      </div>

      <div className={cx(styles['section'])}>
        <Text weight="bold">Historique</Text>
        {user.history.length === 0 ? (
          <Text size="small" tone="secondary">
            Aucun évènement enregistré.
          </Text>
        ) : (
          <ul className={cx(styles['historyList'])}>
            {user.history.map((entry) => (
              <li key={entry.id} className={cx(styles['historyRow'])}>
                <Text size="small">{entry.action}</Text>
                <Text size="small" tone="secondary">
                  {formatDate(entry.createdAt)} — par {entry.actorUserId ?? 'système'}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Stack>
  );
}
