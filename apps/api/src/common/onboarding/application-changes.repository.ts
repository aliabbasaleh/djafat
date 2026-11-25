import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ApplicationChange, Prisma } from '@prisma/client';
import type { MobileMoneyProvider } from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-07 R6): after the approval, a new Mobile Money number or
 * a new paper waits in `application_changes` for an admin, while the approved
 * value keeps working (payouts go to the approved number until then). The
 * table is shared by the `couriers` and `catalog` modules, each for its own
 * applications (`subject_type`); this repository holds the reads and writes
 * they share. Every caller holds its application's transaction lock and
 * passes its transaction.
 */

export type ChangeSubjectType = 'courier' | 'restaurant';
export type ChangeKind = 'mobile_money' | 'document';

/** A change waiting for DJAFAT, as its owner and the admin see it. */
export interface PendingChange {
  readonly id: string;
  readonly kind: ChangeKind;
  /** What it is about: `mobile_money`, `registry_number`, or the photo's kind. */
  readonly topic: string;
  readonly createdAt: string;
  /** The new number (masked for the admin, SPEC-022-07 R2). */
  readonly mobileMoney?: { readonly provider: MobileMoneyProvider; readonly number: string };
  /** A restaurant's new RCCM or NIF number. */
  readonly registryNumber?: string;
}

/** A pending change in the admin's queue (SPEC-022-07 R1, R6): what changed, never the value. */
export interface PendingChangeRow {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: ChangeKind;
  readonly topic: string;
  readonly createdAt: string;
}

/** A decided change, for the e-mail to its owner (R5). */
export interface ChangeDecision {
  readonly changeId: string;
  readonly kind: ChangeKind;
  readonly topic: string;
  readonly status: 'approved' | 'rejected';
}

export type ChangeVerdict = { status: 'approved' } | { status: 'rejected'; reason: string };

/** One field of a change's new value; `null` when absent or not text. */
export function changeValue(value: Prisma.JsonValue, field: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const found = (value as Record<string, unknown>)[field];
  return typeof found === 'string' ? found : null;
}

/** What a change is about: the Mobile Money number, the registry number, or one photo. */
export function changeTopic(kind: string, value: Prisma.JsonValue): string {
  if (kind === 'mobile_money') return 'mobile_money';
  return (
    changeValue(value, 'kind') ??
    (changeValue(value, 'registryNumber') !== null ? 'registry_number' : 'document')
  );
}

/** The new Mobile Money number a change carries, if it is one. */
export function changeMobileMoney(
  change: Pick<ApplicationChange, 'kind' | 'newValue'>,
): { provider: MobileMoneyProvider; number: string } | null {
  if (change.kind !== 'mobile_money') return null;
  const provider = changeValue(change.newValue, 'provider');
  const number = changeValue(change.newValue, 'number');
  if ((provider !== 'airtel' && provider !== 'moov') || !number) return null;
  return { provider, number };
}

/** `maskNumber` hides the new number from the admin, like the approved one. */
export function toPendingChange(
  change: ApplicationChange,
  maskNumber: (e164: string) => string = (e164) => e164,
): PendingChange {
  const mobileMoney = changeMobileMoney(change);
  const registryNumber = changeValue(change.newValue, 'registryNumber');
  return {
    id: change.id,
    kind: change.kind === 'mobile_money' ? 'mobile_money' : 'document',
    topic: changeTopic(change.kind, change.newValue),
    createdAt: change.createdAt.toISOString(),
    ...(mobileMoney
      ? { mobileMoney: { provider: mobileMoney.provider, number: maskNumber(mobileMoney.number) } }
      : {}),
    ...(registryNumber !== null ? { registryNumber } : {}),
  };
}

/**
 * R6: one pending change per topic — a newer one replaces the older (and its
 * photo). Returns the photo key of the change it replaced, for the caller to
 * remove once the transaction is committed.
 */
export async function queueChange(
  tx: Prisma.TransactionClient,
  subjectType: ChangeSubjectType,
  subjectId: string,
  kind: ChangeKind,
  newValue: Record<string, string>,
): Promise<string | null> {
  const replacedKey = await dropPendingChange(
    tx,
    subjectType,
    subjectId,
    changeTopic(kind, newValue),
  );
  await tx.applicationChange.create({ data: { subjectType, subjectId, kind, newValue } });
  return replacedKey;
}

/** Withdraws the pending change of one topic, if any; returns its photo key. */
export async function dropPendingChange(
  tx: Prisma.TransactionClient,
  subjectType: ChangeSubjectType,
  subjectId: string,
  topic: string,
): Promise<string | null> {
  const pending = await tx.applicationChange.findMany({
    where: { subjectType, subjectId, status: 'pending' },
  });
  const same = pending.find((change) => changeTopic(change.kind, change.newValue) === topic);
  if (!same) return null;
  await tx.applicationChange.delete({ where: { id: same.id } });
  return changeValue(same.newValue, 'key');
}

/** The changes of one application still waiting for DJAFAT, oldest first. */
export async function pendingChangesOf(
  db: Prisma.TransactionClient,
  subjectType: ChangeSubjectType,
  subjectId: string,
): Promise<ApplicationChange[]> {
  return db.applicationChange.findMany({
    where: { subjectType, subjectId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
}

/** Every pending change of one type, oldest first (the admin's queue). */
export async function listPendingChanges(
  db: Prisma.TransactionClient,
  subjectType: ChangeSubjectType,
): Promise<PendingChangeRow[]> {
  const rows = await db.applicationChange.findMany({
    where: { subjectType, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    subjectId: row.subjectId,
    kind: row.kind === 'mobile_money' ? 'mobile_money' : 'document',
    topic: changeTopic(row.kind, row.newValue),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * The change to decide, read under the application's lock: 404 when it is
 * not this application's, 409 `ALREADY_DECIDED` once decided (R7).
 */
export async function pendingChangeToDecide(
  tx: Prisma.TransactionClient,
  subjectType: ChangeSubjectType,
  subjectId: string,
  changeId: string,
): Promise<ApplicationChange> {
  const change = await tx.applicationChange.findUnique({ where: { id: changeId } });
  if (!change || change.subjectType !== subjectType || change.subjectId !== subjectId) {
    throw new NotFoundException({
      code: 'CHANGE_NOT_FOUND',
      message: "Ce changement n'existe pas, ou a été remplacé par un plus récent.",
    });
  }
  if (change.status !== 'pending') {
    throw new ConflictException({
      code: 'ALREADY_DECIDED',
      message: 'Ce changement a déjà été décidé par un autre administrateur.',
    });
  }
  return change;
}

/** Saves the decision on the change itself. */
export async function markChangeDecided(
  tx: Prisma.TransactionClient,
  changeId: string,
  adminUserId: string,
  verdict: ChangeVerdict,
): Promise<void> {
  await tx.applicationChange.update({
    where: { id: changeId },
    data: {
      status: verdict.status,
      decidedAt: new Date(),
      decidedBy: adminUserId,
      ...(verdict.status === 'rejected' ? { rejectionReason: verdict.reason } : {}),
    },
  });
}
