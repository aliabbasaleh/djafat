import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CouriersService } from './couriers.service';
import type { PlatformService } from '../platform/platform.service';

function fakePlatform(): PlatformService {
  return {
    getCourierLocationStaleSeconds: vi.fn().mockResolvedValue(120),
  } as unknown as PlatformService;
}

interface CourierRow {
  userId: string;
  status: string;
  activeDeliveryId: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
}

/** A minimal fake sufficient for pure validation + write-path unit tests (no concurrency here — see deliveries-assignment-race.spec.ts for lockAndClaim/release under real parallelism). */
function fakePrisma() {
  const couriers: CourierRow[] = [];
  /** FEAT-022: applications by courier; none = a courier created by the team. */
  const applications = new Map<string, { status: string }>();
  const rawCalls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    courierApplication: {
      findUnique: vi.fn((args: { where: { courierUserId: string } }) =>
        Promise.resolve(applications.get(args.where.courierUserId) ?? null),
      ),
    },
    courier: {
      upsert: vi.fn(
        (args: { where: { userId: string }; create: { userId: string; status: string } }) => {
          let row = couriers.find((c) => c.userId === args.where.userId);
          if (!row) {
            row = {
              userId: args.create.userId,
              status: args.create.status,
              activeDeliveryId: null,
              lastLat: null,
              lastLng: null,
              lastLocationAt: null,
            };
            couriers.push(row);
          }
          return Promise.resolve(row);
        },
      ),
      findUnique: vi.fn((args: { where: { userId: string } }) =>
        Promise.resolve(couriers.find((c) => c.userId === args.where.userId) ?? null),
      ),
      findUniqueOrThrow: vi.fn((args: { where: { userId: string } }) => {
        const row = couriers.find((c) => c.userId === args.where.userId);
        if (!row) throw new Error('not found');
        return Promise.resolve(row);
      }),
      update: vi.fn((args: { where: { userId: string }; data: Record<string, unknown> }) => {
        const row = couriers.find((c) => c.userId === args.where.userId)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
      // Conditional write, like Prisma's: honours `status: { notIn }` in the filter.
      updateMany: vi.fn(
        (args: {
          where: { userId: string; status?: { notIn: string[] } };
          data: Record<string, unknown>;
        }) => {
          const row = couriers.find(
            (c) =>
              c.userId === args.where.userId &&
              !(args.where.status?.notIn ?? []).includes(c.status),
          );
          if (row) Object.assign(row, args.data);
          return Promise.resolve({ count: row ? 1 : 0 });
        },
      ),
      findMany: vi.fn((args: { where: { status?: string }; skip: number; take: number }) => {
        const matches = args.where.status
          ? couriers.filter((c) => c.status === args.where.status)
          : couriers;
        return Promise.resolve(matches.slice(args.skip, args.skip + args.take));
      }),
      count: vi.fn((args: { where: { status?: string } }) => {
        const matches = args.where.status
          ? couriers.filter((c) => c.status === args.where.status)
          : couriers;
        return Promise.resolve(matches.length);
      }),
    },
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      rawCalls.push({ text, values });
      if (text.includes('last_geom')) {
        const [lng, lat, , , , userId] = values as [
          number,
          number,
          unknown,
          unknown,
          unknown,
          string,
        ];
        const row = couriers.find((c) => c.userId === userId);
        if (row) {
          row.lastLat = lat;
          row.lastLng = lng;
          row.lastLocationAt = new Date();
        }
      }
      return Promise.resolve(1);
    }),
  };
  return { db, couriers, rawCalls, applications };
}

describe('CouriersService.setStatus (docs/25 §4, §16)', () => {
  it('online -> offline is allowed with no active delivery', async () => {
    const { db, couriers } = fakePrisma();
    couriers.push({
      userId: 'c1',
      status: 'online',
      activeDeliveryId: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
    });
    const service = new CouriersService(db as never, fakePlatform());
    const result = await service.setStatus('c1', 'offline');
    expect(result.status).toBe('offline');
  });

  it('refuses to go offline while an active delivery is assigned (docs/09 A.6)', async () => {
    const { db, couriers } = fakePrisma();
    couriers.push({
      userId: 'c1',
      status: 'busy',
      activeDeliveryId: 'delivery-1',
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
    });
    const service = new CouriersService(db as never, fakePlatform());
    await expect(service.setStatus('c1', 'offline')).rejects.toMatchObject({
      response: { code: 'DELIVERY_INVALID_STATE' },
    });
  });

  it('a suspended courier can never self-service back online', async () => {
    const { db, couriers } = fakePrisma();
    couriers.push({
      userId: 'c1',
      status: 'suspended',
      activeDeliveryId: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
    });
    const service = new CouriersService(db as never, fakePlatform());
    await expect(service.setStatus('c1', 'online')).rejects.toMatchObject({
      response: { code: 'COURIER_SUSPENDED' },
    });
  });

  // SPEC-022-02-SC04, SPEC-022-06-SC04 (FEAT-022)
  it('SPEC-022-06-SC04 — « En ligne » is refused before the approval, accepted after; a courier without an application goes online as before', async () => {
    const { db, couriers, applications } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());

    applications.set('signed-up', { status: 'pending_review' });
    await expect(service.setStatus('signed-up', 'online')).rejects.toMatchObject({
      status: 409,
      response: { code: 'COURIER_NOT_APPROVED' },
    });
    expect(couriers.find((c) => c.userId === 'signed-up')?.status).toBe('offline');

    applications.set('signed-up', { status: 'approved' });
    await service.setStatus('signed-up', 'online');
    expect(couriers.find((c) => c.userId === 'signed-up')?.status).toBe('online');

    await service.setStatus('team-courier', 'online'); // no application: created by the team
    expect(couriers.find((c) => c.userId === 'team-courier')?.status).toBe('online');
  });

  // SPEC-022-02-SC04 (FEAT-022)
  it('SPEC-022-02-SC04 — a courier « to complete » or refused never goes online; going offline stays possible', async () => {
    const { db, couriers, applications } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    for (const status of ['to_complete', 'rejected']) {
      applications.set(`c-${status}`, { status });
      await expect(service.setStatus(`c-${status}`, 'online')).rejects.toMatchObject({
        response: { code: 'COURIER_NOT_APPROVED' },
      });
      await service.setStatus(`c-${status}`, 'offline');
      expect(couriers.find((c) => c.userId === `c-${status}`)?.status).toBe('offline');
    }
  });

  it('creates the profile lazily on first status write (idempotent)', async () => {
    const { db, couriers } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await service.setStatus('brand-new-courier', 'online');
    expect(couriers).toHaveLength(1);
    expect(couriers[0]!.status).toBe('online');
  });
});

describe('CouriersService.updateLocation — never trusts the client blindly (docs/25 §9, §34)', () => {
  it.each([
    [{ lat: 91, lng: 0 }, 'latitude out of range'],
    [{ lat: -91, lng: 0 }, 'latitude out of range'],
    [{ lat: 0, lng: 181 }, 'longitude out of range'],
    [{ lat: 0, lng: -181 }, 'longitude out of range'],
    [{ lat: NaN, lng: 0 }, 'NaN latitude'],
  ])('rejects impossible coordinates: %o (%s)', async (coords) => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(service.updateLocation('c1', coords)).rejects.toMatchObject({
      response: { code: 'INVALID_LOCATION' },
    });
  });

  it('rejects an accuracy claim that is physically absurd', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, accuracyM: 50_000 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('rejects a negative accuracy (meaningless)', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, accuracyM: -1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an impossible speed (GPS jump / spoofing)', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, speedMps: 200 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('rejects a timestamp far in the future', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, timestamp: future }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('rejects a timestamp far in the past (stale batch replay)', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    const stale = new Date(Date.now() - 3_600_000).toISOString();
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, timestamp: stale }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('rejects a malformed timestamp string', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(
      service.updateLocation('c1', { lat: 12.1, lng: 15.0, timestamp: 'not-a-date' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('accepts a valid, fresh, precise position and records it', async () => {
    const { db, couriers } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await service.updateLocation('c1', {
      lat: 12.1348,
      lng: 15.0557,
      accuracyM: 12,
      speedMps: 5,
      timestamp: new Date().toISOString(),
    });
    expect(couriers[0]!.lastLat).toBe(12.1348);
    expect(couriers[0]!.lastLng).toBe(15.0557);
    expect(couriers[0]!.lastLocationAt).not.toBeNull();
  });

  it('accepts boundary values exactly at ±90/±180', async () => {
    const { db } = fakePrisma();
    const service = new CouriersService(db as never, fakePlatform());
    await expect(service.updateLocation('c1', { lat: 90, lng: 180 })).resolves.toBeUndefined();
    await expect(service.updateLocation('c1', { lat: -90, lng: -180 })).resolves.toBeUndefined();
  });
});

describe('CouriersService.listForAdmin (Bloc 9, docs/30 §admin-api)', () => {
  it('filters by status and paginates', async () => {
    const { db, couriers } = fakePrisma();
    couriers.push(
      {
        userId: 'c1',
        status: 'online',
        activeDeliveryId: null,
        lastLat: null,
        lastLng: null,
        lastLocationAt: null,
      },
      {
        userId: 'c2',
        status: 'offline',
        activeDeliveryId: null,
        lastLat: null,
        lastLng: null,
        lastLocationAt: null,
      },
      {
        userId: 'c3',
        status: 'online',
        activeDeliveryId: null,
        lastLat: null,
        lastLng: null,
        lastLocationAt: null,
      },
    );
    const service = new CouriersService(db as never, fakePlatform());

    const online = await service.listForAdmin('online', 1, 20);
    expect(online.total).toBe(2);
    expect(online.items.every((c) => c.status === 'online')).toBe(true);

    const page1 = await service.listForAdmin(undefined, 1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
  });
});
