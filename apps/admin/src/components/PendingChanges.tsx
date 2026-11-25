'use client';

import { useEffect, useState } from 'react';
import {
  REJECTION_REASON_LENGTH,
  changeTopicText,
  mobileMoneyText,
  rejectionReasonError,
  type ApplicationType,
  type PendingChange,
} from '@djafat/sdk';
import { Heading, Text, cx } from '@djafat/ui';
import { Alert, Button, Modal, Textarea } from '@/components/ui-client';
import { useStepUp } from '@/components/StepUp';
import { api } from '@/lib/api';
import { changeDecisionMessage, decisionErrorMessage, sentOn } from '@/lib/applications';
import { StepUpCancelled } from '@/lib/step-up-flow';
import styles from './ApplicationDetail.module.css';

/** « demandé le 24/11 à 09:00 » — the same N'Djamena time as the queue. */
const askedOn = (iso: string) => sentOn(iso).replace('envoyée', 'demandé');

/**
 * FEAT-022 (SPEC-022-07 R6): after the approval, a new Mobile Money number or
 * a new paper waits here; the approved one keeps working until an admin
 * accepts it. Accepting asks for the authentication code (it moves where
 * the money goes, FEAT-022-Q11); refusing needs a reason the applicant
 * receives by e-mail.
 */
export function PendingChanges({
  type,
  id,
  changes,
  onDecided,
}: {
  readonly type: ApplicationType;
  readonly id: string;
  readonly changes: readonly PendingChange[];
  readonly onDecided: () => Promise<void>;
}) {
  const withStepUp = useStepUp();
  const [photo, setPhoto] = useState<{ title: string; url: string } | null>(null);
  const [refusing, setRefusing] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // « Refuser… »: the focus goes to the reason (the dialog first focuses its close button).
  useEffect(() => {
    if (!refusing) return;
    const timer = setTimeout(
      () => document.querySelector<HTMLTextAreaElement>('textarea[name="change-reason"]')?.focus(),
      0,
    );
    return () => clearTimeout(timer);
  }, [refusing]);

  async function accept(change: PendingChange) {
    if (!window.confirm(`Accepter : ${changeTopicText(change.topic)} ?`)) return;
    setError(null);
    setBusy(change.id);
    try {
      const result = await withStepUp(() =>
        api.admin.applications.approveChange(type, id, change.id),
      );
      setDone(changeDecisionMessage(result, type));
      await onDecided();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setError(decisionErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function refuse() {
    if (!refusing) return;
    const problem = rejectionReasonError(reason);
    if (problem) {
      setReasonError(problem);
      return;
    }
    setBusy(refusing.id);
    try {
      const result = await api.admin.applications.rejectChange(
        type,
        id,
        refusing.id,
        reason.trim(),
      );
      setDone(changeDecisionMessage(result, type));
      setRefusing(null);
      setReason('');
      await onDecided();
    } catch (err) {
      setReasonError(decisionErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function showPhoto(change: PendingChange) {
    setError(null);
    try {
      const link = await api.admin.applications.changePhotoLink(type, id, change.id);
      setPhoto({ title: `${changeTopicText(change.topic)} — nouvelle photo`, url: link.url });
    } catch (err) {
      setError(decisionErrorMessage(err));
    }
  }

  if (changes.length === 0 && !done) return null;
  return (
    <section className={cx(styles['section'])} aria-labelledby="changes-title">
      <Heading level={2} size="h3" id="changes-title">
        Changements en attente ({changes.length})
      </Heading>
      <Text tone="muted" size="small">
        Jusqu’à votre accord, la valeur déjà validée reste en place (les paiements continuent vers
        l’ancien numéro).
      </Text>
      {done && (
        <Alert tone="success" onDismiss={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className={cx(styles['changes'])}>
        {changes.map((change) => (
          <li key={change.id} className={cx(styles['change'])}>
            <span className={cx(styles['changeText'])}>
              <Text as="span" weight="semibold">
                {changeTopicText(change.topic)}
              </Text>
              <Text as="span" size="small">
                {change.mobileMoney
                  ? `Nouveau : ${mobileMoneyText(change.mobileMoney)}`
                  : change.registryNumber
                    ? `Nouveau : ${change.registryNumber}`
                    : 'Nouvelle photo'}
              </Text>
              <Text as="span" size="small" tone="muted">
                {askedOn(change.createdAt)}
              </Text>
            </span>
            <span className={cx(styles['actions'])}>
              {change.kind === 'document' && !change.registryNumber && (
                <Button variant="ghost" size="sm" onClick={() => void showPhoto(change)}>
                  voir la photo
                </Button>
              )}
              <Button
                size="sm"
                loading={busy === change.id && refusing === null}
                onClick={() => void accept(change)}
                aria-label={`Accepter : ${changeTopicText(change.topic)}`}
              >
                Accepter
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setReasonError(null);
                  setRefusing(change);
                }}
                aria-label={`Refuser : ${changeTopicText(change.topic)}`}
              >
                Refuser…
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <Modal open={photo !== null} onClose={() => setPhoto(null)} title={photo?.title ?? ''}>
        {photo && (
          // A private photo by its 5-minute signed link (SPEC-022-04 R3), not a static asset.
          <img className={cx(styles['photo'])} src={photo.url} alt={photo.title} />
        )}
      </Modal>

      <Modal
        open={refusing !== null}
        onClose={() => setRefusing(null)}
        title={refusing ? `Refuser : ${changeTopicText(refusing.topic)}` : ''}
      >
        <form
          className={cx(styles['dialogBody'])}
          onSubmit={(e) => {
            e.preventDefault();
            void refuse();
          }}
        >
          <Textarea
            name="change-reason"
            label="Motif du refus (envoyé par e-mail)"
            helpText={`${REJECTION_REASON_LENGTH.min} à ${REJECTION_REASON_LENGTH.max} caractères.`}
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
            <Button type="submit" variant="danger" loading={busy !== null}>
              Refuser le changement
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRefusing(null)}>
              Annuler
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
