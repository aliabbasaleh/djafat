'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DIAL_CODE,
  MOBILE_MONEY_CHOICES,
  mobileMoneyText,
  pendingChangeOf,
  phoneFieldShowsDialCode,
  restaurantPapersChanges,
  restaurantPapersStart,
  type FieldErrors,
  type MobileMoney,
  type RestaurantPaperKind,
  type RestaurantPapersValues,
} from '@djafat/sdk';
import { Heading, Text, Stack, Skeleton, ErrorState, cx } from '@djafat/ui';
import { Alert, Button, Input, Select } from '@/components/ui-client';
import { PhotoPicker } from '@/components/PhotoPicker';
import { StepBackLink } from '@/components/StepBackLink';
import { api } from '@/lib/api';
import {
  UNDER_REVIEW_TEXT,
  errorText,
  underReview,
  useRestaurantApplication,
} from '@/lib/application';
import { focusFirstInvalid } from '@/lib/focus';
import styles from '../steps.module.css';

type Field = 'registryNumber' | 'provider' | 'number';

const WAITING = 'En attente de DJAFAT';

/**
 * FEAT-022 (SPEC-022-05 R1, step 4): « Papiers et paiement » — the RCCM or
 * NIF number and its photo, the owner's ID, and the Mobile Money number the
 * payments go to. Once validated, a new number or a new paper waits for
 * DJAFAT while the approved one keeps working (SPEC-022-07 R6).
 */
export default function PapersPage() {
  const { application, setApplication, reload, failed } = useRestaurantApplication();
  const [registryNumber, setRegistryNumber] = useState('');
  const [provider, setProvider] = useState<MobileMoney['provider'] | ''>('');
  const [number, setNumber] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<RestaurantPaperKind | null>(null);
  const [photoError, setPhotoError] = useState<Partial<Record<RestaurantPaperKind, string>>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  /** What the fields started from — the value waiting for DJAFAT, else the saved one (R6). */
  const [start, setStart] = useState<RestaurantPapersValues | null>(null);
  const form = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!application || start) return;
    const values = restaurantPapersStart(application);
    setStart(values);
    setRegistryNumber(values.registryNumber);
    setProvider(values.provider);
    setNumber(values.number);
  }, [application, start]);

  const readOnly = underReview(application);
  const approved = application?.status === 'approved';

  async function save() {
    setMessage(null);
    if (!start) return;
    // Only what changed leaves: an untouched field never withdraws its waiting change (R6).
    const { errors: found, request } = restaurantPapersChanges(
      { registryNumber, provider, number },
      start,
    );
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(form.current);
    if (!request) {
      setMessage({ tone: 'success', text: 'Rien n’a changé.' });
      return;
    }
    setSaving(true);
    try {
      const view = await api.restaurant.application.updatePapers(request);
      setApplication(view);
      const next = restaurantPapersStart(view);
      setStart(next);
      setRegistryNumber(next.registryNumber);
      setProvider(next.provider);
      setNumber(next.number);
      setMessage({
        tone: 'success',
        text:
          view.status === 'approved' && view.pendingChanges.length > 0
            ? 'Enregistré : DJAFAT vérifie le changement. Les paiements continuent vers le numéro déjà validé.'
            : 'Papiers et paiement enregistrés.',
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err, "L'enregistrement n'a pas abouti.") });
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: RestaurantPaperKind, file: Blob) {
    setMessage(null);
    setPhotoError((e) => ({ ...e, [kind]: undefined }));
    setUploading(kind);
    try {
      setApplication(await api.restaurant.application.uploadPaper(kind, file));
    } catch (err) {
      setPhotoError((e) => ({ ...e, [kind]: errorText(err, "La photo n'a pas pu être envoyée.") }));
    } finally {
      setUploading(null);
    }
  }

  async function open(kind: RestaurantPaperKind) {
    try {
      const link = await api.restaurant.application.paperLink(kind);
      window.open(link.url, '_blank', 'noopener');
    } catch (err) {
      setPhotoError((e) => ({ ...e, [kind]: errorText(err, "La photo n'a pas pu s'ouvrir.") }));
    }
  }

  if (application === undefined) {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement des papiers">
        <Skeleton height={40} />
        <Skeleton height={320} radius="8px" />
      </Stack>
    );
  }
  if (failed) {
    return (
      <ErrorState
        title="Impossible de charger les papiers"
        action={<Button onClick={() => void reload()}>Réessayer</Button>}
      />
    );
  }
  if (application === null) {
    return (
      <ErrorState
        title="Réservé au responsable d'un restaurant inscrit"
        message="Les papiers et le numéro Mobile Money se gèrent depuis le compte du responsable. Pour un restaurant inscrit par DJAFAT, contactez DJAFAT."
        action={<Button href="/restaurant">Accueil</Button>}
      />
    );
  }

  const waitingNumber = pendingChangeOf(application, 'mobile_money');
  const waitingRegistry = pendingChangeOf(application, 'registry_number');

  return (
    <Stack gap="lg">
      <StepBackLink />
      <Heading level={1}>4. Papiers et paiement</Heading>
      <Text tone="secondary">
        Les photos des papiers restent privées : seuls vous et DJAFAT les voyez.
      </Text>
      {readOnly && <Alert tone="info">{UNDER_REVIEW_TEXT}</Alert>}
      {approved && (
        <Alert tone="info">
          Votre restaurant est validé. Un nouveau numéro Mobile Money ou un nouveau papier attend
          l&apos;accord de DJAFAT ; d&apos;ici là, les paiements continuent vers le numéro déjà
          validé.
        </Alert>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <form
        ref={form}
        className={cx(styles['section'])}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <Input
          label="Numéro RCCM ou NIF"
          placeholder="TD-NDJ-2026-B-1234"
          value={registryNumber}
          onChange={(e) => setRegistryNumber(e.target.value)}
          {...(errors.registryNumber ? { error: errors.registryNumber } : {})}
          disabled={readOnly}
          required
        />
        {waitingRegistry?.registryNumber && (
          <p className={cx(styles['pending'])}>
            ⏳ {WAITING} : {waitingRegistry.registryNumber} (le numéro validé reste{' '}
            {application.papers.registryNumber ?? '—'})
          </p>
        )}
        <Select
          label="Mobile Money pour les paiements"
          value={provider}
          onChange={(e) => setProvider(e.target.value as MobileMoney['provider'] | '')}
          disabled={readOnly}
          aria-invalid={errors.provider ? true : undefined}
          aria-describedby={errors.provider ? 'provider-error' : undefined}
          required
        >
          <option value="">Choisir…</option>
          {MOBILE_MONEY_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
        {errors.provider && (
          <p id="provider-error" role="alert" className={cx(styles['fieldError'])}>
            {errors.provider}
          </p>
        )}
        <Input
          label="Numéro Mobile Money"
          type="tel"
          placeholder="66 12 34 56"
          {...(phoneFieldShowsDialCode(number, 'mobile_money') ? { leadingText: DIAL_CODE } : {})}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          {...(errors.number ? { error: errors.number } : {})}
          disabled={readOnly}
          required
        />
        {waitingNumber?.mobileMoney && (
          <p className={cx(styles['pending'])}>
            ⏳ {WAITING} : {mobileMoneyText(waitingNumber.mobileMoney)}
            {application.mobileMoney
              ? ` — les paiements vont encore vers ${mobileMoneyText(application.mobileMoney)}`
              : ''}
          </p>
        )}
        {!readOnly && (
          <div>
            <Button type="submit" loading={saving}>
              Enregistrer
            </Button>
          </div>
        )}
      </form>

      <div className={cx(styles['section'])}>
        {(['registry', 'owner_id'] as const).map((kind) => {
          const sent =
            kind === 'registry'
              ? application.papers.registryPhoto
              : application.papers.ownerIdPhoto;
          const waiting = pendingChangeOf(application, kind);
          const name = kind === 'registry' ? 'la photo du RCCM ou du NIF' : "la pièce d'identité";
          return (
            <PhotoPicker
              key={kind}
              label={
                kind === 'registry' ? 'Photo du RCCM ou du NIF' : "Pièce d'identité du responsable"
              }
              actionLabel={sent ? `Remplacer ${name}` : `Envoyer ${name}`}
              sent={sent}
              busy={uploading === kind}
              disabled={readOnly}
              error={photoError[kind] ?? null}
              onPick={(file) => void upload(kind, file)}
              extra={
                <>
                  {sent && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void open(kind)}>
                      Voir la photo
                    </Button>
                  )}
                  {waiting && (
                    <p className={cx(styles['pending'])}>⏳ {WAITING} : nouvelle photo</p>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </Stack>
  );
}
