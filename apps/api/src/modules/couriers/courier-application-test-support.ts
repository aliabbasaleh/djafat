import { vi } from 'vitest';
import type { CourierApplication } from '@prisma/client';
import type { AuditLogEntry, AuditService } from '../../common/audit/audit.service';
import { changesTable } from '../../common/onboarding/application-changes-test-support';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PhotoStorage } from '../../infra/storage/photo-storage';
import type { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import type { UserRecord, UsersService } from '../users/users.service';
import { CourierApplicationService } from './courier-application.service';

/**
 * In-memory couriers and applications for `CourierApplicationService` (FEAT-022).
 * A transaction works on the same rows and puts them back if it throws, like
 * PostgreSQL would; the advisory lock is a no-op (one test, one caller).
 */

/** A fake's answer, as the real (async) one: a throw becomes a rejected promise. */
function later<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
  return (...args) => Promise.resolve().then(() => fn(...args));
}

export interface CourierRow {
  userId: string;
  status: string;
  vehicleType: string | null;
  birthDate: Date | null;
  neighbourhoodId: string | null;
  neighbourhoodOther: string | null;
  updatedAt?: Date;
}

export function applicationRow(
  courierUserId: string,
  over: Partial<CourierApplication> = {},
): CourierApplication {
  return {
    courierUserId,
    status: 'to_complete',
    termsAcceptedAt: new Date('2026-11-20T08:00:00Z'),
    mobileMoneyProvider: null,
    mobileMoneyNumber: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    facePhotoKey: null,
    idCardPhotoKey: null,
    drivingLicencePhotoKey: null,
    vehicleRegistrationPhotoKey: null,
    insurancePhotoKey: null,
    platePhotoKey: null,
    rejectionReason: null,
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: new Date('2026-11-20T08:00:00Z'),
    updatedAt: new Date('2026-11-20T08:00:00Z'),
    ...over,
  };
}

/** Every item of a moto courier's list filled (SPEC-022-06 R1). */
export const COMPLETE_MOTO: Partial<CourierApplication> = {
  facePhotoKey: 'private-face.jpg',
  idCardPhotoKey: 'private-id.jpg',
  drivingLicencePhotoKey: 'private-licence.jpg',
  vehicleRegistrationPhotoKey: 'private-registration.jpg',
  insurancePhotoKey: 'private-insurance.jpg',
  platePhotoKey: 'private-plate.jpg',
  mobileMoneyProvider: 'airtel',
  mobileMoneyNumber: '+23566000001',
  emergencyContactName: 'Halimé Abakar',
  emergencyContactPhone: '+23599112233',
};

export function userRecord(id: string, over: Partial<UserRecord> = {}): UserRecord {
  return {
    id,
    phone: '+23566123456',
    phoneVerifiedAt: null,
    emailVerifiedAt: new Date('2026-11-20T08:00:00Z'),
    hasPassword: true,
    email: `${id}@example.td`,
    fullName: 'Abakar Mahamat',
    countryId: null,
    locale: 'fr',
    status: 'active',
    createdAt: new Date('2026-11-20T08:00:00Z'),
    ...over,
  };
}

export function courierWorld() {
  const couriers = new Map<string, CourierRow>();
  const applications = new Map<string, CourierApplication>();
  const users = new Map<string, UserRecord>();
  const audits: AuditLogEntry[] = [];
  // FEAT-022 (SPEC-022-07 R6): changes after the approval.
  const changes = changesTable();
  const stored: string[] = [];
  const removed: string[] = [];
  let nextKey = 0;

  const copy = <T>(row: T | undefined): T | null => (row ? structuredClone(row) : null);

  const client = {
    courier: {
      findUnique: vi.fn(
        later(({ where }: { where: { userId: string } }) => copy(couriers.get(where.userId))),
      ),
      findUniqueOrThrow: vi.fn(
        later(({ where }: { where: { userId: string } }) => {
          const row = couriers.get(where.userId);
          if (!row) throw new Error(`no courier ${where.userId}`);
          return structuredClone(row);
        }),
      ),
      findMany: vi.fn(
        later(({ where }: { where: { userId: { in: string[] } } }) =>
          where.userId.in.flatMap((id) => {
            const row = couriers.get(id);
            return row ? [structuredClone(row)] : [];
          }),
        ),
      ),
      update: vi.fn(
        later(({ where, data }: { where: { userId: string }; data: Partial<CourierRow> }) => {
          const row = couriers.get(where.userId);
          if (!row) throw new Error(`no courier ${where.userId}`);
          Object.assign(row, data);
          return structuredClone(row);
        }),
      ),
      // The names typed under « Autre » (SPEC-022-09 R3), as `groupBy` counts them.
      groupBy: vi.fn(
        later(() => {
          const counts = new Map<string, number>();
          for (const c of couriers.values()) {
            if (c.neighbourhoodId === null && c.neighbourhoodOther !== null) {
              counts.set(c.neighbourhoodOther, (counts.get(c.neighbourhoodOther) ?? 0) + 1);
            }
          }
          return [...counts].map(([neighbourhoodOther, n]) => ({
            neighbourhoodOther,
            _count: { _all: n },
          }));
        }),
      ),
    },
    courierApplication: {
      findUnique: vi.fn(
        later(({ where }: { where: { courierUserId: string } }) =>
          copy(applications.get(where.courierUserId)),
        ),
      ),
      findMany: vi.fn(
        later(({ where }: { where: { status: string } }) =>
          [...applications.values()]
            .filter((a) => a.status === where.status)
            .sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0))
            .map((a) => ({ courierUserId: a.courierUserId, submittedAt: a.submittedAt })),
        ),
      ),
      update: vi.fn(
        later(
          ({
            where,
            data,
          }: {
            where: { courierUserId: string };
            data: Partial<CourierApplication>;
          }) => {
            const row = applications.get(where.courierUserId);
            if (!row) throw new Error(`no application ${where.courierUserId}`);
            Object.assign(row, data);
            return structuredClone(row);
          },
        ),
      ),
    },
    applicationChange: changes.model,
    $executeRaw: vi.fn(later(() => 1)),
  };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => {
      const before = {
        couriers: structuredClone([...couriers]),
        applications: structuredClone([...applications]),
        changes: changes.snapshot(),
        audits: audits.length,
      };
      try {
        return await fn(client);
      } catch (err) {
        couriers.clear();
        for (const [k, v] of before.couriers) couriers.set(k, v);
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
        const key = `${family}-${(nextKey += 1)}.jpg`;
        stored.push(key);
        return { key };
      }),
    ),
    link: vi.fn(later((key: string) => `http://api.test/v1/files/${key}?exp=1&sig=s`)),
    remove: vi.fn(
      later((key: string) => {
        removed.push(key);
      }),
    ),
  };

  const neighbourhoods = {
    listAll: vi.fn(
      later(() => [
        { id: 'n-moursal', name: 'Moursal', active: true, fromReferenceData: true },
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

  const service = new CourierApplicationService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotoStorage,
    { getById: vi.fn(later((id: string) => users.get(id) ?? null)) } as unknown as UsersService,
    neighbourhoods as unknown as NeighbourhoodsService,
    audit as unknown as AuditService,
  );

  /** A courier who signed up (SPEC-022-02): offline, with an application. */
  function signedUp(
    userId: string,
    options: {
      vehicle?: string;
      application?: Partial<CourierApplication>;
      user?: Partial<UserRecord>;
      neighbourhoodId?: string | null;
      neighbourhoodOther?: string | null;
    } = {},
  ): void {
    couriers.set(userId, {
      userId,
      status: 'offline',
      vehicleType: options.vehicle ?? 'moto',
      birthDate: new Date('2001-04-12T00:00:00Z'),
      neighbourhoodId:
        options.neighbourhoodId === undefined ? 'n-moursal' : options.neighbourhoodId,
      neighbourhoodOther: options.neighbourhoodOther ?? null,
    });
    applications.set(userId, applicationRow(userId, options.application));
    users.set(userId, userRecord(userId, options.user));
  }

  return {
    service,
    couriers,
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
