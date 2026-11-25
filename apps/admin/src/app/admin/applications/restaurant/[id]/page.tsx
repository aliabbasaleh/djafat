'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ApiClientError,
  REJECTION_REASON_LENGTH,
  mobileMoneyText,
  rejectionReasonError,
  type RestaurantApplicationReview,
  type RestaurantPaperKind,
} from '@djafat/sdk';
import { Heading, Text, Stack, Badge, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Alert, Modal, Textarea } from '@/components/ui-client';
import { PendingChanges } from '@/components/PendingChanges';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import {
  RESTAURANT_PAPER_LABELS,
  decisionErrorMessage,
  decisionMessage,
  paperAlt,
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
 * FEAT-022 (SPEC-022-07 R2–R6, FEAT-022-VIS06): one restaurant's application —
 * the owner (phone masked), the location, the hours and the menu, the logo and
 * the cover, the papers (each through a 5-minute signed link), the Mobile
 * Money number (masked); then « Valider » (visible to customers) or
 * « Refuser… » with a reason the owner receives by e-mail; once validated, the
 * changes waiting for a decision.
 */
export default function RestaurantApplicationPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [review, setReview] = useState<RestaurantApplicationReview | null>(null);
  const [paper, setPaper] = useState<{ kind: RestaurantPaperKind; url: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReview(await api.admin.applications.getRestaurant(id));
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

  useEffect(() => {
    if (!rejecting) return;
    const timer = setTimeout(
      () => document.querySelector<HTMLTextAreaElement>('textarea[name="reject-reason"]')?.focus(),
      0,
    );
    return () => clearTimeout(timer);
  }, [rejecting]);

  async function showPaper(kind: RestaurantPaperKind) {
    setActionError(null);
    try {
      const link = await api.admin.applications.restaurantPaperLink(id, kind);
      setPaper({ kind, url: link.url });
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
    } else if (
      !window.confirm(
        `Valider « ${review?.name ?? 'ce restaurant'} » ? Il sera visible des clients.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result =
        decision === 'approve'
          ? await api.admin.applications.approveRestaurant(id)
          : await api.admin.applications.rejectRestaurant(id, reason.trim());
      setDone(decisionMessage(result, 'restaurant'));
      setRejecting(false);
      setReason('');
      await load();
    } catch (err) {
      const message = decisionErrorMessage(err);
      if (decision === 'reject' && rejecting) setReasonError(message);
      else setActionError(message);
      // What changed meanwhile (a step that no longer holds) shows on the page.
      if (err instanceof ApiClientError && err.code === 'APPLICATION_INCOMPLETE') await load();
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
        action={<Button href="/admin/applications?type=restaurant">Retour aux demandes</Button>}
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
  const { lat, lng } = review.location;
  return (
    <Stack gap="lg">
      <div>
        <Button variant="ghost" size="sm" href="/admin/applications?type=restaurant">
          ← Demandes à vérifier
        </Button>
      </div>
      <Stack gap="sm">
        <Heading level={1}>{review.name} — restaurant</Heading>
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
          <dt>Quartier</dt>
          <dd>{review.neighbourhood ? `${review.neighbourhood}, N’Djamena` : '—'}</dd>
          <dt>Responsable</dt>
          <dd>
            {review.owner.name ?? '—'}
            {review.owner.phone ? `, ${review.owner.phone}` : ''}
          </dd>
          <dt>Emplacement</dt>
          <dd>
            {review.location.addressText ?? '—'}
            {review.location.landmark ? ` — repère : ${review.location.landmark}` : ''}
            {lat !== null && lng !== null ? (
              <>
                {' · '}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  voir sur la carte
                </a>
              </>
            ) : (
              ' · aucun point sur la carte'
            )}
          </dd>
          <dt>Horaires</dt>
          <dd>{review.hasOpeningHours ? 'renseignés' : 'aucun'}</dd>
          <dt>Menu</dt>
          <dd>
            {review.pricedProducts === 0
              ? 'aucun plat avec un prix'
              : `${review.pricedProducts} plat${review.pricedProducts > 1 ? 's' : ''} avec un prix`}
          </dd>
          <dt>Numéro RCCM ou NIF</dt>
          <dd>{review.registryNumber ?? '—'}</dd>
          <dt>Mobile Money</dt>
          <dd>{review.mobileMoney ? mobileMoneyText(review.mobileMoney) : '—'}</dd>
          <dt>Envoi</dt>
          <dd>{review.submittedAt ? sentOn(review.submittedAt) : 'pas encore envoyée'}</dd>
        </dl>
      </section>

      <section className={cx(styles['section'])} aria-labelledby="images-title">
        <Heading level={2} size="h3" id="images-title">
          Logo et photos
        </Heading>
        <div className={cx(styles['images'])}>
          {review.logoUrl ? (
            <img
              className={cx(styles['logo'])}
              src={review.logoUrl}
              alt={`Logo de ${review.name}`}
            />
          ) : (
            <Text tone="muted">Pas de logo</Text>
          )}
          {review.coverUrl ? (
            <img
              className={cx(styles['cover'])}
              src={review.coverUrl}
              alt={`Photo de couverture de ${review.name}`}
            />
          ) : (
            <Text tone="muted">Pas de photo de couverture</Text>
          )}
        </div>
      </section>

      <section className={cx(styles['section'])} aria-labelledby="papers-title">
        <Heading level={2} size="h3" id="papers-title">
          Papiers
        </Heading>
        <Text tone="muted" size="small">
          Chaque photo s’ouvre par un lien valable 5 minutes, jamais par une adresse publique.
        </Text>
        <ul className={cx(styles['photos'])}>
          {(['registry', 'owner_id'] as const).map((kind) => {
            const sent =
              kind === 'registry' ? review.papers.registryPhoto : review.papers.ownerIdPhoto;
            return (
              <li key={kind} className={cx(styles['photoRow'])}>
                <Text as="span">{RESTAURANT_PAPER_LABELS[kind]}</Text>
                {sent ? (
                  <Button variant="secondary" size="sm" onClick={() => void showPaper(kind)}>
                    voir la photo
                  </Button>
                ) : (
                  <Text as="span" tone="muted" size="small">
                    (pas envoyée)
                  </Text>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {review.status === 'approved' && (
        <PendingChanges
          type="restaurant"
          id={id}
          changes={review.pendingChanges}
          onDecided={load}
        />
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
        open={paper !== null}
        onClose={() => setPaper(null)}
        title={paper ? RESTAURANT_PAPER_LABELS[paper.kind] : ''}
      >
        {paper && (
          // A private paper by its 5-minute signed link (SPEC-022-04 R3), not a static asset.
          <img
            className={cx(styles['photo'])}
            src={paper.url}
            alt={paperAlt(paper.kind, review.name)}
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
            label="Motif du refus (envoyé au responsable)"
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
