import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CourierCandidate, CourierPort, GeoPoint } from '@djafat/types';
import { isValidLatLng } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';

export interface CourierProfileDto {
  userId: string;
  status: string;
  activeDeliveryId: string | null;
  lastLocationAt: string | null;
}

export interface LocationUpdateInput {
  lat: number;
  lng: number;
  accuracyM?: number | undefined;
  heading?: number | undefined;
  speedMps?: number | undefined;
  /** ISO-8601, client-reported capture time — validated against server clock (docs/25 §9, §34). */
  timestamp?: string | undefined;
}

const MAX_ACCURACY_M = 500; // beyond this, the fix is too imprecise to trust for dispatch/eligibility
const MAX_SPEED_MPS = 45; // ~162 km/h — generous ceiling for a moto/car in city traffic; anything past this is spoofed/GPS-jump
const MAX_CLOCK_SKEW_SECONDS = 300; // reject a timestamp more than 5 min in the future or 5 min stale

/**
 * Courier availability + last-known position (Bloc 6, docs/25 §4, §9, §34).
 * 1:1 profile row per `users` (role='courier') — never courier fields on
 * `User` itself (docs/17 D-02 precedent: domain-specific state lives in its
 * own table, never bolted onto the shared identity row).
 */
@Injectable()
export class CouriersService implements CourierPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  /** Idempotent — first status/location write for a courier creates the profile row. */
  private async ensureProfile(userId: string): Promise<void> {
    await this.prisma.courier.upsert({
      where: { userId },
      update: {},
      create: { userId, status: 'offline' },
    });
  }

  async getProfile(userId: string): Promise<CourierProfileDto> {
    const row = await this.prisma.courier.findUnique({ where: { userId } });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `No courier profile for ${userId}.`,
      });
    }
    return this.toDto(row);
  }

  /**
   * `offline -> online -> busy -> offline` etc. (docs/25 §4, §16). A courier
   * may never go OFFLINE while holding an active delivery (docs/09 A.6) —
   * finish or explicitly cancel first. `SUSPENDED` is admin-only; enforced
   * by RBAC at the controller (a `courier`-role actor can never request it).
   */
  async setStatus(userId: string, status: 'offline' | 'online'): Promise<CourierProfileDto> {
    await this.ensureProfile(userId);
    const current = await this.prisma.courier.findUniqueOrThrow({ where: { userId } });
    if (current.status === 'suspended') {
      throw new ConflictException({
        code: 'COURIER_SUSPENDED',
        message: 'This courier account is suspended.',
      });
    }
    if (status === 'offline' && current.activeDeliveryId) {
      throw new ConflictException({
        code: 'DELIVERY_INVALID_STATE',
        message: 'Cannot go offline with an active delivery — finish or cancel it first.',
      });
    }
    const updated = await this.prisma.courier.update({ where: { userId }, data: { status } });
    return this.toDto(updated);
  }

  /**
   * Validates and records a position update (docs/25 §9, §34). NEVER trusts
   * the client blindly: bounds-checks lat/lng, rejects an impossible
   * accuracy/speed/timestamp. Silent on success (the caller decides whether
   * to also emit `courier.location_updated`).
   */
  async updateLocation(userId: string, input: LocationUpdateInput): Promise<void> {
    if (!isValidLatLng({ lat: input.lat, lng: input.lng })) {
      throw new ConflictException({
        code: 'INVALID_LOCATION',
        message: 'Latitude/longitude out of range.',
      });
    }
    if (
      input.accuracyM !== undefined &&
      (input.accuracyM < 0 || input.accuracyM > MAX_ACCURACY_M)
    ) {
      throw new ConflictException({
        code: 'INVALID_LOCATION',
        message: `Accuracy out of an acceptable range (0-${MAX_ACCURACY_M}m).`,
      });
    }
    if (input.speedMps !== undefined && (input.speedMps < 0 || input.speedMps > MAX_SPEED_MPS)) {
      throw new ConflictException({
        code: 'INVALID_LOCATION',
        message: 'Reported speed is physically implausible.',
      });
    }
    if (input.timestamp !== undefined) {
      const ts = new Date(input.timestamp).getTime();
      if (Number.isNaN(ts)) {
        throw new ConflictException({ code: 'INVALID_LOCATION', message: 'Invalid timestamp.' });
      }
      const skewSeconds = (Date.now() - ts) / 1000;
      if (skewSeconds < -MAX_CLOCK_SKEW_SECONDS || skewSeconds > MAX_CLOCK_SKEW_SECONDS) {
        throw new ConflictException({
          code: 'INVALID_LOCATION',
          message: 'Timestamp is too far from the server clock.',
        });
      }
    }

    await this.ensureProfile(userId);
    await this.prisma.$executeRaw`
      UPDATE couriers SET
        last_geom = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
        last_accuracy_m = ${input.accuracyM ?? null},
        last_heading = ${input.heading ?? null},
        last_speed_mps = ${input.speedMps ?? null},
        last_location_at = now()
      WHERE user_id = ${userId}::uuid
    `;
  }

  /**
   * Candidates for dispatch (docs/25 §11): ONLINE, not suspended, not busy
   * (all implied by `status = 'online'` — the three are mutually exclusive
   * values, docs/25 §4), a fresh-enough fix, within `radiusMeters` of
   * `pickup`, nearest first. A single indexed PostGIS query — never a full
   * table scan resolved in TypeScript (docs/25 §51).
   */
  async findEligibleCandidates(
    pickup: GeoPoint,
    radiusMeters: number,
    excludeCourierIds: readonly string[] = [],
  ): Promise<CourierCandidate[]> {
    const staleSeconds = await this.platform.getCourierLocationStaleSeconds();
    const excluded =
      excludeCourierIds.length > 0 ? excludeCourierIds : ['00000000-0000-0000-0000-000000000000'];
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; distance_m: number }>>`
      SELECT user_id, ST_Distance(last_geom, ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography) AS distance_m
      FROM couriers
      WHERE status = 'online'
        AND active_delivery_id IS NULL
        AND last_geom IS NOT NULL
        AND last_location_at > now() - (${staleSeconds}::text || ' seconds')::interval
        AND NOT (user_id = ANY(${excluded}::uuid[]))
        AND ST_DWithin(last_geom, ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography, ${radiusMeters})
      ORDER BY distance_m ASC
      LIMIT 20
    `;
    return rows.map((r) => ({ courierId: r.user_id, distanceMeters: r.distance_m }));
  }

  /**
   * Transactional claim (docs/25 §12-13): the caller (`deliveries`) already
   * holds the delivery row lock and passes its OWN transaction client, so
   * this join is atomic with the delivery-side assignment write. Lock order
   * is always delivery-then-courier — never the reverse (docs/25 §39,
   * enforced by convention: this method is only ever called from inside
   * `deliveries`' own `$transaction`, after it has already locked the
   * delivery row).
   */
  async lockAndClaim(
    tx: Prisma.TransactionClient,
    courierId: string,
    deliveryId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ status: string; active_delivery_id: string | null }>>`
      SELECT status, active_delivery_id FROM couriers WHERE user_id = ${courierId}::uuid FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.status !== 'online' || row.active_delivery_id !== null) {
      return false;
    }
    await tx.$executeRaw`
      UPDATE couriers SET status = 'busy', active_delivery_id = ${deliveryId}::uuid
      WHERE user_id = ${courierId}::uuid
    `;
    return true;
  }

  /** Admin-only (docs/25 §35) — a suspended courier is never a dispatch candidate, regardless of `active_delivery_id`. */
  async suspend(userId: string): Promise<CourierProfileDto> {
    await this.ensureProfile(userId);
    const row = await this.prisma.courier.update({
      where: { userId },
      data: { status: 'suspended' },
    });
    return this.toDto(row);
  }

  async reinstate(userId: string): Promise<CourierProfileDto> {
    await this.ensureProfile(userId);
    const row = await this.prisma.courier.update({
      where: { userId },
      data: { status: 'offline' },
    });
    return this.toDto(row);
  }

  /** Releases a courier back to `online` (delivery completed/cancelled/failed) — idempotent. */
  async release(tx: Prisma.TransactionClient, courierId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE couriers SET status = 'online', active_delivery_id = NULL
      WHERE user_id = ${courierId}::uuid AND status = 'busy'
    `;
  }

  private toDto(row: {
    userId: string;
    status: string;
    activeDeliveryId: string | null;
    lastLocationAt: Date | null;
  }): CourierProfileDto {
    return {
      userId: row.userId,
      status: row.status,
      activeDeliveryId: row.activeDeliveryId,
      lastLocationAt: row.lastLocationAt ? row.lastLocationAt.toISOString() : null,
    };
  }
}
