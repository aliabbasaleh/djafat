'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  DIAL_CODE,
  phoneFieldShowsDialCode,
  phoneForSending,
  type RestaurantProfile,
  type UpdateRestaurantProfileInput,
} from '@djafat/sdk';
import { Heading, Text, Stack, Inline, Badge, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Input, Textarea, Alert } from '@/components/ui-client';
import { PhotoPicker } from '@/components/PhotoPicker';
import { StepBackLink } from '@/components/StepBackLink';
import { api } from '@/lib/api';
import { errorText, underReview, useRestaurantApplication } from '@/lib/application';
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
 * FEAT-022 (SPEC-022-05 R1, R2 — step 3, « Logo et photos »): the logo and
 * the cover are chosen from the computer or the phone and stored by DJAFAT
 * (`POST /restaurants/me/photos/:kind`, SPEC-022-04 R4), no longer typed as
 * web addresses. Saving sends only what changed; while DJAFAT checks the
 * application, the address and the photos do not change (R5).
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
    prepTimeMin: 20,
    minOrder: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [photoError, setPhotoError] = useState<{ logo?: string; cover?: string }>({});
  const canWrite = isOwner(getStoredUser());
  // FEAT-022 (SPEC-022-05 R5): steps 1 and 3 read only while DJAFAT checks the application.
  const { application } = useRestaurantApplication();
  const locked = underReview(application);

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
      // FEAT-022: only what changed — an untouched address is not « changed » during the review.
      const changes: UpdateRestaurantProfileInput = {
        ...(form.name !== profile.name ? { name: form.name } : {}),
        ...(form.description !== (profile.description ?? '')
          ? { description: form.description }
          : {}),
        // FEAT-024: the field shows « +235 »; 8 digits typed leave in international format.
        ...(form.phone !== (profile.phone ?? '')
          ? { phone: form.phone.trim() ? phoneForSending(form.phone) : form.phone }
          : {}),
        ...(form.addressText !== (profile.addressText ?? '')
          ? { addressText: form.addressText }
          : {}),
        ...(form.prepTimeMin !== profile.prepTimeMin ? { prepTimeMin: form.prepTimeMin } : {}),
        ...(form.minOrder !== Number(profile.minOrder.minor)
          ? { minOrderMinor: toMinorString(form.minOrder) }
          : {}),
      };
      if (Object.keys(changes).length > 0) await api.restaurant.update(profile.id, changes);
      setSuccess('Profil mis à jour.');
      await load();
    } catch (err) {
      setError(errorText(err, 'Échec de la mise à jour.'));
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

  async function upload(kind: 'logo' | 'cover', file: Blob) {
    setPhotoError((e) => ({ ...e, [kind]: undefined }));
    setUploading(kind);
    try {
      const photos = await api.restaurant.application.uploadPhoto(kind, file);
      setProfile((p) => (p ? { ...p, logoUrl: photos.logoUrl, coverUrl: photos.coverUrl } : p));
    } catch (err) {
      setPhotoError((e) => ({ ...e, [kind]: errorText(err, "L'image n'a pas pu être envoyée.") }));
    } finally {
      setUploading(null);
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
      <StepBackLink />
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
      {locked && (
        <Alert tone="info">
          Votre dossier est en vérification par DJAFAT : l&apos;adresse, le logo et la photo de
          couverture ne se modifient plus pour le moment.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <section aria-labelledby="photos-title">
        <Stack gap="md">
          <Heading level={2} id="photos-title">
            Logo et photos
          </Heading>
          <Inline gap="lg" wrap align="start">
            <PhotoPicker
              label="Logo"
              actionLabel={profile.logoUrl ? 'Remplacer le logo' : 'Choisir le logo'}
              preview={
                profile.logoUrl ? { url: profile.logoUrl, alt: `Logo de ${profile.name}` } : null
              }
              busy={uploading === 'logo'}
              disabled={!canWrite || locked}
              error={photoError.logo ?? null}
              onPick={(file) => void upload('logo', file)}
            />
            <PhotoPicker
              label="Photo de couverture"
              actionLabel={profile.coverUrl ? 'Remplacer la couverture' : 'Choisir la couverture'}
              preview={
                profile.coverUrl
                  ? { url: profile.coverUrl, alt: `Photo de couverture de ${profile.name}` }
                  : null
              }
              wide
              busy={uploading === 'cover'}
              disabled={!canWrite || locked}
              error={photoError.cover ?? null}
              onPick={(file) => void upload('cover', file)}
            />
          </Inline>
        </Stack>
      </section>

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
          disabled={!canWrite || locked}
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
