import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infra/prisma/prisma.service';

export interface AddressRecord {
  id: string;
  userId: string;
  label: string | null;
  recipientPhone: string | null;
  cityId: string | null;
  quartier: string | null;
  street: string | null;
  landmark: string | null;
  instructions: string | null;
  geocodeStatus: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  lat: number | null;
  lng: number | null;
}

export interface CityRecord {
  id: string;
  name?: string;
}

/**
 * Real-concurrency harness for `AddressesService` (Bloc 8, docs/29) — same
 * discipline as every lock-aware fake used throughout this codebase
 * (`carts.service.spec.ts`'s `carts_one_open_per_user`,
 * `deliveries-test-support.ts`'s partial unique indexes): the partial unique
 * index `addresses_one_default_per_user` (migration 0027) is enforced FOR
 * REAL by this fake — a synchronous check-then-write, atomic within this
 * single-threaded harness exactly as a real Postgres unique index is atomic —
 * so a genuine `Promise.all([...])` race exercises the actual constraint
 * rather than a scripted one-shot rejection.
 *
 * A per-user lock queue simulates the row lock a real UPDATE touching the
 * "current default" row takes: acquired by the first write in a transaction
 * that reads/mutates a user's default flag, held until that transaction's
 * callback resolves or rejects — exactly how a real Postgres row lock is held
 * until COMMIT/ROLLBACK, never released mid-transaction.
 */
export function makeAddressesRaceDb() {
  const addresses: AddressRecord[] = [];
  const cities: CityRecord[] = [];

  const userLockTail = new Map<string, Promise<void>>();
  async function acquireUserLock(userId: string): Promise<() => void> {
    const previous = userLockTail.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    userLockTail.set(
      userId,
      previous.then(() => mine),
    );
    await previous;
    return release;
  }

  function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `addresses_one_default_per_user`',
      { code: 'P2002', clientVersion: '6.2.1' },
    );
  }

  /** The partial unique index itself — checked on every write that could set `isDefault = true`. */
  function assertSingleDefault(userId: string, exceptId?: string): void {
    const defaults = addresses.filter(
      (a) => a.userId === userId && a.isDefault && a.id !== exceptId,
    );
    if (defaults.length > 0) throw uniqueViolation();
  }

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  function toRawRow(a: AddressRecord) {
    return {
      id: a.id,
      label: a.label,
      recipient_phone: a.recipientPhone,
      city_id: a.cityId,
      city_name: a.cityId ? (cities.find((c) => c.id === a.cityId)?.name ?? null) : null,
      quartier: a.quartier,
      street: a.street,
      landmark: a.landmark,
      instructions: a.instructions,
      geocode_status: a.geocodeStatus,
      is_default: a.isDefault,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
      lat: a.lat,
      lng: a.lng,
    };
  }

  /**
   * One client per transaction attempt. `heldLocks`/`pendingReleases` are
   * scoped to THIS transaction: a user lock is acquired at most once per
   * transaction (repeat touches of the same user's rows within one
   * transaction must never try to re-acquire a lock it already holds — that
   * would deadlock against itself) and released only when the transaction
   * itself finishes.
   */
  function makeClient(heldLocks: Set<string>, pendingReleases: Array<() => void>) {
    async function lockUser(userId: string): Promise<void> {
      if (heldLocks.has(userId)) return;
      heldLocks.add(userId);
      pendingReleases.push(await acquireUserLock(userId));
    }

    return {
      address: {
        count: vi.fn(async (args: { where: { userId: string; isDefault?: boolean } }) => {
          await Promise.resolve();
          return addresses.filter(
            (a) =>
              a.userId === args.where.userId &&
              (args.where.isDefault === undefined || a.isDefault === args.where.isDefault),
          ).length;
        }),
        findFirst: vi.fn(
          async (args: {
            where: { id?: string; userId: string; isDefault?: boolean };
            orderBy?: { createdAt: 'asc' | 'desc' };
          }) => {
            await Promise.resolve();
            let matches = addresses.filter(
              (a) =>
                a.userId === args.where.userId &&
                (args.where.id === undefined || a.id === args.where.id) &&
                (args.where.isDefault === undefined || a.isDefault === args.where.isDefault),
            );
            if (args.orderBy?.createdAt === 'desc') {
              matches = [...matches].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
            }
            return matches[0] ?? null;
          },
        ),
        create: vi.fn(
          async (args: {
            data: {
              userId: string;
              label: string | null;
              recipientPhone: string | null;
              cityId: string | null;
              quartier: string | null;
              street: string | null;
              landmark: string | null;
              instructions: string | null;
              geocodeStatus: string;
              isDefault: boolean;
            };
          }) => {
            await lockUser(args.data.userId);
            if (args.data.isDefault) assertSingleDefault(args.data.userId);
            const now = new Date();
            const row: AddressRecord = {
              id: randomUUID(),
              createdAt: now,
              updatedAt: now,
              lat: null,
              lng: null,
              ...args.data,
            };
            addresses.push(row);
            return row;
          },
        ),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = addresses.find((a) => a.id === args.where.id);
          if (!row) throw new Error(`address ${args.where.id} not found in fake`);
          await lockUser(row.userId);
          if (args.data['isDefault'] === true) assertSingleDefault(row.userId, row.id);
          Object.assign(row, args.data, { updatedAt: new Date() });
          return row;
        }),
        updateMany: vi.fn(
          async (args: {
            where: { userId: string; isDefault?: boolean; id?: { not: string } };
            data: { isDefault: boolean };
          }) => {
            await lockUser(args.where.userId);
            const matches = addresses.filter(
              (a) =>
                a.userId === args.where.userId &&
                (args.where.isDefault === undefined || a.isDefault === args.where.isDefault) &&
                (args.where.id?.not === undefined || a.id !== args.where.id.not),
            );
            if (args.data.isDefault && matches.length > 1) throw uniqueViolation();
            for (const row of matches) {
              row.isDefault = args.data.isDefault;
              row.updatedAt = new Date();
            }
            return { count: matches.length };
          },
        ),
        deleteMany: vi.fn(async (args: { where: { id: string; userId: string } }) => {
          await lockUser(args.where.userId);
          const before = addresses.length;
          const remaining = addresses.filter(
            (a) => !(a.id === args.where.id && a.userId === args.where.userId),
          );
          const removedCount = before - remaining.length;
          addresses.length = 0;
          addresses.push(...remaining);
          return { count: removedCount };
        }),
      },
      city: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => {
          await Promise.resolve();
          return cities.find((c) => c.id === args.where.id) ?? null;
        }),
      },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        await Promise.resolve();
        const text = rawText(strings);
        if (
          text.includes('FROM addresses') &&
          text.includes('a.id =') &&
          text.includes('a.user_id =')
        ) {
          const [addressId, userId] = values as [string, string];
          const row = addresses.find((a) => a.id === addressId && a.userId === userId);
          return row ? [toRawRow(row)] : [];
        }
        if (text.includes('FROM addresses') && text.includes('a.user_id =')) {
          const [userId] = values as [string];
          const rows = addresses
            .filter((a) => a.userId === userId)
            .sort((a, b) =>
              a.isDefault !== b.isDefault
                ? a.isDefault
                  ? -1
                  : 1
                : b.createdAt.getTime() - a.createdAt.getTime(),
            );
          return rows.map(toRawRow);
        }
        throw new Error(`Unhandled $queryRaw in addresses fake: ${text}`);
      }),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        await Promise.resolve();
        const text = rawText(strings);
        if (text.includes('UPDATE addresses SET geom')) {
          const [lng, lat, addressId] = values as [number, number, string];
          const row = addresses.find((a) => a.id === addressId);
          if (row) {
            row.lat = lat;
            row.lng = lng;
            if (text.includes("geocode_status = 'ok'")) row.geocodeStatus = 'ok';
          }
          return 1;
        }
        throw new Error(`Unhandled $executeRaw in addresses fake: ${text}`);
      }),
    };
  }

  const store = {
    ...makeClient(new Set(), []),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const heldLocks = new Set<string>();
      const pendingReleases: Array<() => void> = [];
      const tx = makeClient(heldLocks, pendingReleases);
      try {
        return await fn(tx);
      } finally {
        for (const release of pendingReleases) release();
      }
    }),
  };

  return { db: store as unknown as PrismaService, addresses, cities };
}
