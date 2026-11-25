import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infra/prisma/prisma.service';

export interface UserRow {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  countryId: string | null;
  locale: string;
  status: string;
  phoneVerifiedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface RoleRow {
  userId: string;
  role: string;
  scopeRestaurantId: string | null;
}

/**
 * Lock-free fake for `UsersService`'s role-management methods (Bloc 9,
 * docs/30 §role-management) — every mutation here is a SINGLE raw statement
 * (no multi-step transaction), so, unlike `addresses-test-support.ts`, no
 * per-user async lock queue is needed: the two invariants under test
 * (migration 0028's partial unique index, and the table's own composite
 * primary key) are each a synchronous check-then-write, exactly as atomic in
 * this single-threaded fake as a real index is in Postgres — a genuine
 * `Promise.all([...])` race still exercises the actual conflict, since
 * nothing here ever awaits between the check and the write.
 */
export function makeUsersFakeDb() {
  const users: UserRow[] = [];
  const roles: RoleRow[] = [];
  const restaurants: Array<{ id: string }> = [];

  function uniqueViolation(constraint: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed: ${constraint}`, {
      code: 'P2002',
      clientVersion: '6.2.1',
    });
  }

  function rawText(strings: TemplateStringsArray): string {
    return strings.join('?');
  }

  const db = {
    user: {
      findFirst: vi.fn((args: { where: { id?: string; phone?: string; deletedAt: null } }) => {
        const found = users.find(
          (u) =>
            u.deletedAt === null &&
            (args.where.id === undefined || u.id === args.where.id) &&
            (args.where.phone === undefined || u.phone === args.where.phone),
        );
        return Promise.resolve(found ?? null);
      }),
      findMany: vi.fn(
        (args: {
          where: {
            deletedAt: null;
            OR?: Array<{ phone?: { contains: string }; fullName?: { contains: string } }>;
          };
          skip: number;
          take: number;
        }) => {
          const term = args.where.OR?.[0]?.phone?.contains?.toLowerCase();
          let matches = users.filter((u) => u.deletedAt === null);
          if (term) {
            matches = matches.filter(
              (u) =>
                u.phone.toLowerCase().includes(term) ||
                (u.fullName ?? '').toLowerCase().includes(term),
            );
          }
          return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
        },
      ),
      count: vi.fn(
        (args: {
          where: {
            deletedAt: null;
            OR?: Array<{ phone?: { contains: string }; fullName?: { contains: string } }>;
          };
        }) => {
          const term = args.where.OR?.[0]?.phone?.contains?.toLowerCase();
          let matches = users.filter((u) => u.deletedAt === null);
          if (term) {
            matches = matches.filter(
              (u) =>
                u.phone.toLowerCase().includes(term) ||
                (u.fullName ?? '').toLowerCase().includes(term),
            );
          }
          return Promise.resolve(matches.length);
        },
      ),
      update: vi.fn((args: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.find((u) => u.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
      updateMany: vi.fn(
        (args: { where: { id: string; phoneVerifiedAt: null }; data: Partial<UserRow> }) => {
          const row = users.find(
            (u) => u.id === args.where.id && u.phoneVerifiedAt === args.where.phoneVerifiedAt,
          );
          if (!row) return Promise.resolve({ count: 0 });
          Object.assign(row, args.data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    restaurant: {
      findUnique: vi.fn((args: { where: { id: string } }) => {
        const found = restaurants.find((r) => r.id === args.where.id);
        return Promise.resolve(found ?? null);
      }),
    },
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      const text = rawText(strings);

      // FEAT-022: the per-account lock of a role grant (one caller per test: a no-op).
      if (text.includes('pg_advisory_xact_lock')) return Promise.resolve(1);

      if (text.includes('INSERT INTO user_roles')) {
        const [userId, role, scopeRestaurantId] = values as [string, string, string | null];
        const exactMatch = roles.find(
          (r) =>
            r.userId === userId && r.role === role && r.scopeRestaurantId === scopeRestaurantId,
        );
        if (exactMatch) return Promise.resolve(0); // ON CONFLICT ON CONSTRAINT user_roles_pkey DO NOTHING

        if (role === 'restaurant_owner' || role === 'restaurant_staff') {
          const differentScope = roles.find(
            (r) => r.userId === userId && r.role === role && r.scopeRestaurantId !== null,
          );
          if (differentScope) {
            throw uniqueViolation('user_roles_one_restaurant_per_staff');
          }
        }
        roles.push({ userId, role, scopeRestaurantId });
        return Promise.resolve(1);
      }

      if (text.includes('DELETE FROM user_roles')) {
        const [userId, role, scopeRestaurantId] = values as [string, string, string | null];
        const before = roles.length;
        const remaining = roles.filter(
          (r) =>
            !(r.userId === userId && r.role === role && r.scopeRestaurantId === scopeRestaurantId),
        );
        const removed = before - remaining.length;
        roles.length = 0;
        roles.push(...remaining);
        return Promise.resolve(removed);
      }

      if (text.includes('INSERT INTO user_roles (user_id, role) VALUES')) {
        const [userId] = values as [string];
        roles.push({ userId, role: 'customer', scopeRestaurantId: null });
        return Promise.resolve(1);
      }

      throw new Error(`Unhandled $executeRaw in users fake: ${text}`);
    }),
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = rawText(strings);

      // FEAT-022 (FEAT-022-Q25): a restaurant role held at ANOTHER restaurant.
      if (text.includes('AS other FROM user_roles')) {
        const [userId, scopeRestaurantId] = values as [string, string | null];
        return Promise.resolve(
          roles
            .filter(
              (r) =>
                r.userId === userId &&
                (r.role === 'restaurant_owner' || r.role === 'restaurant_staff') &&
                r.scopeRestaurantId !== null &&
                r.scopeRestaurantId !== scopeRestaurantId,
            )
            .slice(0, 1)
            .map((r) => ({ other: r.scopeRestaurantId })),
        );
      }
      if (text.includes('SELECT role, scope_restaurant_id FROM user_roles')) {
        const [userId] = values as [string];
        return Promise.resolve(
          roles
            .filter((r) => r.userId === userId)
            .map((r) => ({ role: r.role, scope_restaurant_id: r.scopeRestaurantId })),
        );
      }
      if (text.includes('SELECT DISTINCT role FROM user_roles')) {
        const [userId] = values as [string];
        return Promise.resolve(
          [...new Set(roles.filter((r) => r.userId === userId).map((r) => r.role))].map((role) => ({
            role,
          })),
        );
      }
      if (text.includes('FROM user_roles') && text.includes('role IN')) {
        const [userId, restaurantId] = values as [string, string];
        const match = roles.find(
          (r) =>
            r.userId === userId &&
            r.scopeRestaurantId === restaurantId &&
            (r.role === 'restaurant_owner' || r.role === 'restaurant_staff'),
        );
        return Promise.resolve(match ? [{ ok: true }] : []);
      }
      if (text.includes('FROM role_permissions')) {
        return Promise.resolve([]);
      }
      throw new Error(`Unhandled $queryRaw in users fake: ${text}`);
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };

  return {
    db: db as unknown as PrismaService,
    users,
    roles,
    restaurants,
  };
}

export function seedUser(users: UserRow[], overrides: Partial<UserRow> = {}): UserRow {
  const now = new Date();
  const row: UserRow = {
    id: randomUUID(),
    phone: `+235${Math.floor(Math.random() * 1e8)}`,
    fullName: null,
    email: null,
    countryId: null,
    locale: 'fr',
    status: 'active',
    phoneVerifiedAt: null,
    deletedAt: null,
    createdAt: now,
    ...overrides,
  };
  users.push(row);
  return row;
}
