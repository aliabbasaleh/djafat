import { vi } from 'vitest';
import type { RestaurantApplication } from '@prisma/client';
import type { AuditLogEntry, AuditService } from '../../common/audit/audit.service';
import { changesTable } from '../../common/onboarding/application-changes-test-support';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PhotoStorage } from '../../infra/storage/photo-storage';
import type { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import type { UserRecord, UsersService } from '../users/users.service';
import { RestaurantApplicationService } from './restaurant-application.service';

/**
 * In-memory restaurants and applications for `RestaurantApplicationService`
 * (FEAT-022, SPEC-022-05, SPEC-022-07). A transaction works on the same rows
 * and puts them back if it throws, like PostgreSQL; the advisory lock is a
 * no-op. The map point (`geom`, raw SQL) is kept as `lat`/`lng`.
 */

function later<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
  return (...args) => Promise.resolve().then(() => fn(...args));
}

export interface RestaurantRow {
  id: string;
  name: string;
  status: string;
  ownerUserId: string | null;
  addressText: string | null;
  landmark: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  neighbourhoodId: string | null;
  neighbourhoodOther: string | null;
  lat: number | null;
  lng: number | null;
  /** Opening slots and dish prices (minor units), counted by the service. */
  hours: number;
  prices: bigint[];
  updatedAt?: Date;
}

export function restaurantApplicationRow(
  restaurantId: string,
  over: Partial<RestaurantApplication> = {},
): RestaurantApplication {
  return {
    restaurantId,
    status: 'to_complete',
    termsAcceptedAt: new Date('2026-11-20T08:00:00Z'),
    registryNumber: null,
    registryPhotoKey: null,
    ownerIdPhotoKey: null,
    mobileMoneyProvider: null,
    mobileMoneyNumber: null,
    rejectionReason: null,
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: new Date('2026-11-20T08:00:00Z'),
    updatedAt: new Date('2026-11-20T08:00:00Z'),
    ...over,
  };
}

/** The four steps filled (SPEC-022-05 R1): what a restaurant ready to send has. */
export const FOUR_STEPS: {
  restaurant: Partial<RestaurantRow>;
  application: Partial<RestaurantApplication>;
} = {
  restaurant: {
    lat: 12.1067,
    lng: 15.0444,
    addressText: 'Avenue Charles de Gaulle, Klémat',
    landmark: 'En face de la pharmacie du Centre',
    hours: 7,
    prices: [150_000n],
    logoUrl: 'http://api.test/v1/files/public-00000000-0000-4000-8000-000000000001.jpg',
    coverUrl: 'http://api.test/v1/files/public-00000000-0000-4000-8000-000000000002.jpg',
  },
  application: {
    registryNumber: 'TD-NDJ-2026-B-1234',
    registryPhotoKey: 'private-registry.jpg',
    ownerIdPhotoKey: 'private-owner-id.jpg',
    mobileMoneyProvider: 'airtel',
    mobileMoneyNumber: '+23566000001',
  },
};

export function restaurantWorld() {
  const restaurants = new Map<string, RestaurantRow>();
  const applications = new Map<string, RestaurantApplication>();
  const users = new Map<string, UserRecord>();
  const scopes = new Map<string, string>();
  const changes = changesTable();
  const audits: AuditLogEntry[] = [];
  const stored: string[] = [];
  const removed: string[] = [];
  let nextKey = 0;

  const copy = <T>(row: T | undefined): T | null => (row ? structuredClone(row) : null);
  const restaurantOf = (id: string) => {
    const row = restaurants.get(id);
    if (!row) throw new Error(`no restaurant ${id}`);
    return row;
  };

  const client = {
    restaurant: {
      findUnique: vi.fn(
        later(({ where }: { where: { id: string } }) => copy(restaurants.get(where.id))),
      ),
      findUniqueOrThrow: vi.fn(
        later(({ where }: { where: { id: string } }) => structuredClone(restaurantOf(where.id))),
      ),
      findMany: vi.fn(
        later(({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.flatMap((id) => {
            const row = restaurants.get(id);
            return row ? [structuredClone(row)] : [];
          }),
        ),
      ),
      update: vi.fn(
        later(({ where, data }: { where: { id: string }; data: Partial<RestaurantRow> }) => {
          const row = restaurantOf(where.id);
          Object.assign(row, data);
          return structuredClone(row);
        }),
      ),
      // The names typed under « Autre » (SPEC-022-09 R3), as `groupBy` counts them.
      groupBy: vi.fn(
        later(() => {
          const counts = new Map<string, number>();
          for (const r of restaurants.values()) {
            if (r.neighbourhoodId === null && r.neighbourhoodOther !== null) {
              counts.set(r.neighbourhoodOther, (counts.get(r.neighbourhoodOther) ?? 0) + 1);
            }
          }
          return [...counts].map(([neighbourhoodOther, n]) => ({
            neighbourhoodOther,
            _count: { _all: n },
          }));
        }),
      ),
    },
    restaurantApplication: {
      findUnique: vi.fn(
        later(({ where }: { where: { restaurantId: string } }) =>
          copy(applications.get(where.restaurantId)),
        ),
      ),
      findMany: vi.fn(
        later(({ where }: { where: { status: string } }) =>
          [...applications.values()]
            .filter((a) => a.status === where.status)
            .sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0))
            .map((a) => ({ restaurantId: a.restaurantId, submittedAt: a.submittedAt })),
        ),
      ),
      update: vi.fn(
        later(
          ({
            where,
            data,
          }: {
            where: { restaurantId: string };
            data: Partial<RestaurantApplication>;
          }) => {
            const row = applications.get(where.restaurantId);
            if (!row) throw new Error(`no application ${where.restaurantId}`);
            Object.assign(row, data);
            return structuredClone(row);
          },
        ),
      ),
    },
    restaurantHours: {
      count: vi.fn(
        later(
          ({ where }: { where: { restaurantId: string } }) =>
            restaurantOf(where.restaurantId).hours,
        ),
      ),
    },
    product: {
      count: vi.fn(
        later(
          ({ where }: { where: { restaurantId: string; priceMinor: { gt: bigint } } }) =>
            restaurantOf(where.restaurantId).prices.filter((p) => p > where.priceMinor.gt).length,
        ),
      ),
    },
    applicationChange: changes.model,
    // The advisory lock, or step 1's `UPDATE restaurants … geom` (address, landmark, lng, lat, id).
    $executeRaw: vi.fn(
      later((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!strings.join('?').includes('UPDATE restaurants')) return 1;
        const [addressText, landmark, lng, lat, id] = values as [
          string,
          string | null,
          number,
          number,
          string,
        ];
        Object.assign(restaurantOf(id), { addressText, landmark, lng, lat });
        return 1;
      }),
    ),
    // `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng … WHERE id = $1`
    $queryRaw: vi.fn(
      later((_strings: TemplateStringsArray, ...values: unknown[]) => {
        const row = restaurants.get(values[0] as string);
        return row ? [{ lat: row.lat, lng: row.lng }] : [];
      }),
    ),
  };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => {
      const before = {
        restaurants: structuredClone([...restaurants]),
        applications: structuredClone([...applications]),
        changes: changes.snapshot(),
        audits: audits.length,
      };
      try {
        return await fn(client);
      } catch (err) {
        restaurants.clear();
        for (const [k, v] of before.restaurants) restaurants.set(k, v);
        applications.clear();
        for (const [k, v] of before.applications) applications.set(k, v);
        changes.restore(before.changes);
        audits.splice(before.audits);
        throw err;
      }
    }),
  };

  const photos = {
    store: vi.fn(
      later((family: 'private' | 'public') => {
        nextKey += 1;
        const key =
          family === 'public'
            ? `public-00000000-0000-4000-8000-${String(nextKey).padStart(12, '0')}.jpg`
            : `private-${nextKey}.jpg`;
        stored.push(key);
        return { key };
      }),
    ),
    link: vi.fn(later((key: string) => `http://api.test/v1/files/${key}`)),
    remove: vi.fn(
      later((key: string) => {
        removed.push(key);
      }),
    ),
  };

  const neighbourhoods = {
    listAll: vi.fn(
      later(() => [
        { id: 'n-klemat', name: 'Klémat', active: true, fromReferenceData: true },
        { id: 'n-abena', name: 'Abena', active: false, fromReferenceData: true },
      ]),
    ),
  };

  const audit = {
    log: vi.fn(
      later((entry: AuditLogEntry) => {
        audits.push(entry);
      }),
    ),
  };

  const usersService = {
    getById: vi.fn(later((id: string) => users.get(id) ?? null)),
    getRestaurantScope: vi.fn(later((userId: string) => scopes.get(userId) ?? null)),
  };

  const service = new RestaurantApplicationService(
    prisma as unknown as PrismaService,
    neighbourhoods as unknown as NeighbourhoodsService,
    photos as unknown as PhotoStorage,
    usersService as unknown as UsersService,
    audit as unknown as AuditService,
  );

  /** A restaurant that signed up (SPEC-022-03): `draft`, its owner scoped to it, an application. */
  function signedUp(
    restaurantId: string,
    ownerUserId: string,
    options: {
      restaurant?: Partial<RestaurantRow>;
      application?: Partial<RestaurantApplication> | null;
      owner?: Partial<UserRecord>;
    } = {},
  ): void {
    restaurants.set(restaurantId, {
      id: restaurantId,
      name: 'Chez Fatimé',
      status: 'draft',
      ownerUserId,
      addressText: null,
      landmark: null,
      logoUrl: null,
      coverUrl: null,
      neighbourhoodId: 'n-klemat',
      neighbourhoodOther: null,
      lat: null,
      lng: null,
      hours: 0,
      prices: [],
      ...options.restaurant,
    });
    if (options.application !== null) {
      applications.set(restaurantId, restaurantApplicationRow(restaurantId, options.application));
    }
    scopes.set(ownerUserId, restaurantId);
    users.set(ownerUserId, {
      id: ownerUserId,
      phone: '+23566123456',
      phoneVerifiedAt: null,
      emailVerifiedAt: new Date('2026-11-20T08:00:00Z'),
      hasPassword: true,
      email: `${ownerUserId}@example.td`,
      fullName: 'Fatimé Abdelkerim',
      countryId: null,
      locale: 'fr',
      status: 'active',
      createdAt: new Date('2026-11-20T08:00:00Z'),
      ...options.owner,
    });
  }

  return {
    service,
    restaurants,
    applications,
    changes,
    users,
    audits,
    stored,
    removed,
    photos,
    signedUp,
  };
}
