import { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Test support for FEAT-023 (`WhatsappCodeService`): an in-memory
 * `whatsapp_codes` table that keeps the documented constraints of migration
 * 0042 — a unique `token_hash`, and two codes waiting for their message never
 * sharing a `code_hash` (P2002, like PostgreSQL's partial unique index).
 * Test code only.
 */

export interface WhatsappCodeRow {
  id: string;
  purpose: string;
  codeHash: string;
  tokenHash: string;
  userId: string | null;
  challengeId: string | null;
  senderPhone: string | null;
  outcome: string | null;
  matchedUserId: string | null;
  receivedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

type Where = Partial<{
  id: string;
  codeHash: string;
  tokenHash: string;
  receivedAt: null;
  consumedAt: null;
  expiresAt: { gt?: Date; lt?: Date };
}>;

const later =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): Promise<R> =>
    Promise.resolve().then(() => fn(...args));

const unique = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

export function fakeWhatsappCodes() {
  const rows: WhatsappCodeRow[] = [];
  const matches = (r: WhatsappCodeRow, w: Where) =>
    (w.id === undefined || r.id === w.id) &&
    (w.codeHash === undefined || r.codeHash === w.codeHash) &&
    (w.tokenHash === undefined || r.tokenHash === w.tokenHash) &&
    (!('receivedAt' in w) || r.receivedAt === null) &&
    (!('consumedAt' in w) || r.consumedAt === null) &&
    (!w.expiresAt?.gt || r.expiresAt > w.expiresAt.gt) &&
    (!w.expiresAt?.lt || r.expiresAt < w.expiresAt.lt);
  const whatsappCode = {
    create: vi.fn(
      later(
        ({
          data,
        }: {
          data: Partial<WhatsappCodeRow> &
            Pick<WhatsappCodeRow, 'purpose' | 'codeHash' | 'tokenHash' | 'expiresAt'>;
        }) => {
          if (rows.some((r) => r.tokenHash === data.tokenHash)) throw unique();
          if (rows.some((r) => r.receivedAt === null && r.codeHash === data.codeHash))
            throw unique();
          const row: WhatsappCodeRow = {
            id: `wa-${rows.length + 1}`,
            userId: null,
            challengeId: null,
            senderPhone: null,
            outcome: null,
            matchedUserId: null,
            receivedAt: null,
            consumedAt: null,
            createdAt: new Date(),
            ...data,
          };
          rows.push(row);
          return row;
        },
      ),
    ),
    findFirst: vi.fn(
      later(({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null),
    ),
    findUnique: vi.fn(
      later(
        ({ where }: { where: { tokenHash: string } }) =>
          rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      ),
    ),
    updateMany: vi.fn(
      later(({ where, data }: { where: Where; data: Partial<WhatsappCodeRow> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
    ),
    deleteMany: vi.fn(
      later(({ where }: { where: Where }) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      }),
    ),
  };
  return { rows, whatsappCode };
}

/** One Prisma fake for the WhatsApp codes and the pending password logins (`fakeChallenges`). */
export function prismaWith(parts: Record<string, unknown>): PrismaService {
  return parts as unknown as PrismaService;
}
