'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ApiClientError,
  REJECTION_REASON_LENGTH,
  rejectionReasonError,
  type ApplicationPhoto,
  type CourierApplicationReview,
} from '@djafat/sdk';
import { Heading, Text, Stack, Badge, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Alert, Modal, Textarea } from '@/components/ui-client';
import { PendingChanges } from '@/components/PendingChanges';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import {
  PHOTO_LABELS,
  PROVIDER_LABELS,
  VEHICLE_LABELS,
  birthAndAge,
  decisionErrorMessage,
  decisionMessage,
  photoAlt,
  sentOn,
} from '@/lib/applications';
import styles from '@/components/ApplicationDetail.module.css';

type LoadState = 'loading' | 'ready' | 'error' | 'missing';

const STATUS_LABEL: Record<
  string,
  { tone: 'warning' | 'success' | 'danger' | 'neutral'; label: string }
> = {
  pending_review: { tone: 'warning', label: 'En attente de vérification' },
  approved: { tone: 'success', label: 'Validé' },
  rejected: { tone: 'danger', label: 'Refusé' },
  to_complete: { tone: 'neutral', label: 'Pas encore envoyé' },
};

/**
 * FEAT-022 (SPEC-022-07 R2–R6, FEAT-022-VIS06): one courier's application —
 * the facts, the photos (each through a 5-minute signed link), then
 * « Valider » or « Refuser… » with a reason the courier receives by e-mail;
 * once validated, the changes waiting for a decision (R6).
 */
export default function CourierApplicationPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [review, setReview] = useState<CourierApplicationReview | null>(null);
  const [photo, setPhoto] = useState<{ kind: ApplicationPhoto['kind']; url: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReview(await api.admin.applications.getCourier(id));
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      setState(
        err instanceof ApiClientError && err.code === 'APPLICATION_NOT_FOUND' ? 'missing' : 'error',
      );
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // « Refuser… »: the focus goes to the reason (the dialog first focuses its close button).
  useEffect(() => {
    if (!rejecting) return;
    const timer = setTimeout(
      () => document.querySelector<HTMLTextAreaElement>('textarea[name="reject-reason"]')?.focus(),
      0,
    );
    return () => clearTimeout(timer);
  }, [rejecting]);

  async function showPhoto(kind: ApplicationPhoto['kind']) {
    setActionError(null);
    try {
      const link = await api.admin.applications.courierPhotoLink(id, kind);
      setPhoto({ kind, url: link.url });
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Photo introuvable.');
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject') {
      const problem = rejectionReasonError(reason);
      if (problem) {
        setReasonError(problem);
        return;
      }
    } else if (!window.confirm(`Valider le dossier de ${review?.name ?? 'ce livreur'} ?`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result =
        decision === 'approve'
          ? await api.admin.applications.approveCourier(id)
          : await api.admin.applications.rejectCourier(id, reason.trim());
      setDone(decisionMessage(result));
      setRejecting(false);
      setReason('');
      await load();
    } catch (err) {
      const message = decisionErrorMessage(err);
      if (decision === 'reject' && rejecting) setReasonError(message);
      else setActionError(message);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement du dossier">
        <Skeleton height={40} />
        <Skeleton height={240} radius="8px" />
      </Stack>
    );
  }
  if (state === 'missing') {
    return (
      <ErrorState
        title="Ce dossier n’existe plus"
        action={<Button href="/admin/applications?type=courier">Retour aux demandes</Button>}
      />
    );
  }
  if (state === 'error' || !review) {
    return (
      <ErrorState
        title="Impossible de charger le dossier"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  const status = STATUS_LABEL[review.status] ?? STATUS_LABEL['to_complete']!;
  return (
    <Stack gap="lg">
      <div>
        <Button variant="ghost" size="sm" href="/admin/applications?type=courier">
          ← Demandes à vérifier
        </Button>
      </div>
      <Stack gap="sm">
        <Heading level={1}>{review.name ?? 'Livreur'} — livreur</Heading>
        <div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </Stack>

      {done && (
        <Alert tone="success" onDismiss={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {review.previousRejectionReason && (
        <Alert tone="info" title="Déjà refusé une fois">
          Motif donné : « {review.previousRejectionReason} »
        </Alert>
      )}

      <section className={cx(styles['section'])} aria-labelledby="facts-title">
        <Heading level={2} size="h3" id="facts-title">
          Informations
        </Heading>
        <dl className={cx(styles['facts'])}>
          <dt>Date de naissance</dt>
          <dd>{birthAndAge(review)}</dd>
          <dt>Véhicule</dt>
          <dd>{review.vehicle ? (VEHICLE_LABELS[review.vehicle] ?? review.vehicle) : '—'}</dd>
          <dt>Quartier</dt>
          <dd>{review.neighbourhood ? `${review.neighbourhood}, N’Djamena` : '—'}</dd>
          <dt>Mobile Money</dt>
          <dd>
            {review.mobileMoney
              ? `${PROVIDER_LABELS[review.mobileMoney.provider] ?? review.mobileMoney.provider} ${review.mobileMoney.number}`
              : '—'}
          </dd>
          <dt>Contact d’urgence</dt>
          <dd>
            {review.emergencyContact
              ? `${review.emergencyContact.name} — ${review.emergencyContact.phone}`
              : '—'}
          </dd>
          <dt>Envoi</dt>
          <dd>{review.submittedAt ? sentOn(review.submittedAt) : 'pas encore envoyée'}</dd>
        </dl>
      </section>

      <section className={cx(styles['section'])} aria-labelledby="photos-title">
        <Heading level={2} size="h3" id="photos-title">
          Photos
        </Heading>
        <Text tone="muted" size="small">
          Chaque photo s’ouvre par un lien valable 5 minutes, jamais par une adresse publique.
        </Text>
        <ul className={cx(styles['photos'])}>
          {review.photos.map((p) => (
            <li key={p.kind} className={cx(styles['photoRow'])}>
              <Text as="span">{PHOTO_LABELS[p.kind]}</Text>
              {p.uploaded ? (
                <Button variant="secondary" size="sm" onClick={() => void showPhoto(p.kind)}>
                  voir la photo
                </Button>
              ) : (
                <Text as="span" tone="muted" size="small">
                  (pas envoyée)
                </Text>
              )}
            </li>
          ))}
        </ul>
      </section>

      {review.status === 'approved' && (
        <PendingChanges type="courier" id={id} changes={review.pendingChanges} onDecided={load} />
      )}

      {review.status === 'pending_review' && (
        <div className={cx(styles['actions'])}>
          <Button loading={busy && !rejecting} onClick={() => void decide('approve')}>
            Valider
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setReasonError(null);
              setRejecting(true);
            }}
          >
            Refuser…
          </Button>
        </div>
      )}

      <Modal
        open={photo !== null}
        onClose={() => setPhoto(null)}
        title={photo ? PHOTO_LABELS[photo.kind] : ''}
      >
        {photo && (
          // A private photo by its 5-minute signed link (SPEC-022-04 R3), not a static asset.
          <img
            className={cx(styles['photo'])}
            src={photo.url}
            alt={photoAlt(photo.kind, review.name)}
          />
        )}
      </Modal>

      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Refuser le dossier">
        <form
          className={cx(styles['dialogBody'])}
          onSubmit={(e) => {
            e.preventDefault();
            void decide('reject');
          }}
        >
          <Textarea
            name="reject-reason"
            label="Motif du refus (envoyé au livreur)"
            helpText={`${REJECTION_REASON_LENGTH.min} à ${REJECTION_REASON_LENGTH.max} caractères. Dites ce qu’il faut corriger.`}
            value={reason}
            maxLength={REJECTION_REASON_LENGTH.max}
            rows={4}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(null);
            }}
            {...(reasonError ? { error: reasonError } : {})}
          />
          <div className={cx(styles['actions'])}>
            <Button type="submit" variant="danger" loading={busy}>
              Refuser le dossier
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
              Annuler
            </Button>
          </div>
        </form>
      </Modal>
    </Stack>
  );
}
