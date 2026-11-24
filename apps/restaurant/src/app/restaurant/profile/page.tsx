'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  DIAL_CODE,
  phoneFieldShowsDialCode,
  phoneForSending,
  type RestaurantProfile,
} from '@djafat/sdk';
import { Heading, Text, Stack, Inline, Badge, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Input, Textarea, Alert } from '@/components/ui-client';
import { api } from '@/lib/api';
import { clearSession, getStoredUser, isOwner } from '@/lib/auth-storage';
import { formatMoney, toMinorString } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

const AVAILABILITY_LABEL: Record<RestaurantProfile['availability'], string> = {
  OPEN: 'Ouvert',
  CLOSED: 'Fermé (hors horaires ou fermeture ponctuelle)',
  PAUSED: 'En pause',
  UNAVAILABLE: 'Indisponible (statut non public)',
};
const AVAILABILITY_TONE: Record<
  RestaurantProfile['availability'],
  'success' | 'neutral' | 'warning' | 'danger'
> = {
  OPEN: 'success',
  CLOSED: 'neutral',
  PAUSED: 'warning',
  UNAVAILABLE: 'danger',
};

/**
 * Restaurant profile (Bloc 10, docs/33 §profile) — read for everyone with
 * access, write gated to `restaurant_owner` client-side (the API re-checks
 * via `restaurants:write`, seed docs/19: `restaurant_staff` does not hold
 * it). "Fermer maintenant" / "Rouvrir" reuses the EXISTING self-service
 * `status` field (`draft`/`active`/`paused`) rather than inventing a second
 * on/off switch — see `RestaurantsManagementService.getMine`'s doc comment.
 *
 * `logoUrl`/`coverUrl` are plain URL fields, matching the API contract
 * exactly (`UpdateRestaurantSchema.logoUrl: z.string().url()`) — there is no
 * file-upload pipeline to wire to (the object-storage adapter is still a
 * Bloc-0 placeholder that throws on every call; see docs/33 §dette). Pasting
 * an already-hosted image URL is the one upload path the backend actually
 * supports today.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    phone: '',
    addressText: '',
    logoUrl: '',
    coverUrl: '',
    prepTimeMin: 20,
    minOrder: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canWrite = isOwner(getStoredUser());

  const load = useCallback(async () => {
    setState('loading');
    try {
      const p = await api.restaurant.getMine();
      setProfile(p);
      setForm({
        name: p.name,
        description: p.description ?? '',
        phone: p.phone ?? '',
        addressText: p.addressText ?? '',
        logoUrl: p.logoUrl ?? '',
        coverUrl: p.coverUrl ?? '',
        prepTimeMin: p.prepTimeMin,
        minOrder: Number(p.minOrder.minor),
      });
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

  async function save() {
    if (!profile) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await api.restaurant.update(profile.id, {
        name: form.name,
        description: form.description,
        // FEAT-024: the field shows « +235 »; 8 digits typed leave in international format.
        phone: form.phone.trim() ? phoneForSending(form.phone) : form.phone,
        addressText: form.addressText,
        logoUrl: form.logoUrl,
        coverUrl: form.coverUrl,
        prepTimeMin: form.prepTimeMin,
        minOrderMinor: toMinorString(form.minOrder),
      });
      setSuccess('Profil mis à jour.');
      await load();
    } catch {
      setError('Échec de la mise à jour.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOpen() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      await api.restaurant.update(profile.id, {
        status: profile.status === 'paused' ? 'active' : 'paused',
      });
      await load();
    } catch {
      setError('Échec du changement de statut.');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading') {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement du profil">
        <Skeleton height={40} />
        <Skeleton height={300} radius="8px" />
      </Stack>
    );
  }
  if (state === 'error' || !profile) {
    return (
      <ErrorState
        title="Impossible de charger le profil"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Inline justify="between" align="center" wrap>
        <Heading level={1}>Profil</Heading>
        <Badge tone={AVAILABILITY_TONE[profile.availability]} dot>
          {AVAILABILITY_LABEL[profile.availability]}
        </Badge>
      </Inline>

      {profile.status === 'suspended' || profile.status === 'closed' ? (
        <Alert tone="warning">
          Ce restaurant est {profile.status === 'suspended' ? 'suspendu' : 'fermé'} par
          l’administration DJAFAT — seul un administrateur peut lever cet état.
        </Alert>
      ) : (
        <div>
          <Button
            variant={profile.status === 'paused' ? 'primary' : 'secondary'}
            disabled={saving || !canWrite}
            onClick={() => void toggleOpen()}
          >
            {profile.status === 'paused' ? 'Rouvrir le restaurant' : 'Fermer maintenant'}
          </Button>
        </div>
      )}

      {!canWrite && (
        <Alert tone="info">
          Seul le propriétaire du restaurant peut modifier ces informations. Vous pouvez les
          consulter.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <form
        className={cx(styles['grid'])}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          label="Nom"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={!canWrite}
          required
        />
        <Input
          label="Téléphone"
          type="tel"
          placeholder="66 12 34 56"
          {...(phoneFieldShowsDialCode(form.phone) ? { leadingText: DIAL_CODE } : {})}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          disabled={!canWrite}
        />
        <Input
          label="Adresse"
          value={form.addressText}
          onChange={(e) => setForm({ ...form, addressText: e.target.value })}
          disabled={!canWrite}
        />
        <Input
          label="Temps de préparation (min)"
          type="number"
          min={0}
          max={240}
          value={form.prepTimeMin}
          onChange={(e) => setForm({ ...form, prepTimeMin: Number(e.target.value) })}
          disabled={!canWrite}
        />
        <Input
          label={`Commande minimum (${profile.currency})`}
          type="number"
          min={0}
          value={form.minOrder}
          onChange={(e) => setForm({ ...form, minOrder: Number(e.target.value) })}
          disabled={!canWrite}
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          disabled={!canWrite}
          rows={3}
        />
        <Input
          label="URL du logo"
          type="url"
          placeholder="https://…"
          value={form.logoUrl}
          onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
          disabled={!canWrite}
        />
        <Input
          label="URL de la couverture"
          type="url"
          placeholder="https://…"
          value={form.coverUrl}
          onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
          disabled={!canWrite}
        />

        {(form.logoUrl || form.coverUrl) && (
          <Inline gap="md">
            {form.logoUrl && (
              <img src={form.logoUrl} alt="Logo" className={cx(styles['preview'])} />
            )}
            {form.coverUrl && (
              <img src={form.coverUrl} alt="Couverture" className={cx(styles['previewWide'])} />
            )}
          </Inline>
        )}

        {canWrite && (
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        )}
      </form>

      <Text size="small" tone="secondary">
        Commande minimum actuelle : {formatMoney(profile.minOrder)}
      </Text>
    </Stack>
  );
}
