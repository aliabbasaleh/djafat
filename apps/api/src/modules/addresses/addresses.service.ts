import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  describeDropoff,
  isValidLatLng,
  learnDropoffPoint,
  type LandmarkRelation,
  type LearnOutcome,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type {
  CreateAddressInput,
  LandmarkQuery,
  UpdateAddressInput,
  VoiceNoteInput,
} from './dto/addresses.schema';

export interface LandmarkDto {
  readonly id: string;
  readonly cityId: string;
  readonly name: string;
  readonly kind: string;
  readonly lat: number;
  readonly lng: number;
}

export interface AddressDto {
  readonly id: string;
  readonly label: string | null;
  readonly recipientPhone: string | null;
  readonly cityId: string | null;
  /** The city's display name, joined at read time — not stored redundantly on `addresses`. */
  readonly cityName: string | null;
  readonly quartier: string | null;
  readonly street: string | null;
  readonly landmark: string | null;
  readonly instructions: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly geocodeStatus: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  // FEAT-018
  readonly landmarkId: string | null;
  readonly landmarkName: string | null;
  readonly landmarkRelation: LandmarkRelation | null;
  readonly doorHint: string | null;
  /** Where `lat`/`lng` come from: typed by the customer, phone GPS, the landmark, or learned. */
  readonly geomSource: string;
  /** The point learned from couriers' GPS at delivery — what the courier is sent to. */
  readonly learnedPoint: {
    readonly lat: number;
    readonly lng: number;
    readonly count: number;
  } | null;
  readonly hasVoiceNote: boolean;
  /** « Derrière Grande Mosquée — portail bleu », or null. */
  readonly deliveryHint: string | null;
}

interface AddressRow {
  id: string;
  label: string | null;
  recipient_phone: string | null;
  city_id: string | null;
  city_name: string | null;
  quartier: string | null;
  street: string | null;
  landmark: string | null;
  instructions: string | null;
  geocode_status: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
  lat: number | null;
  lng: number | null;
  landmark_id?: string | null;
  landmark_name?: string | null;
  landmark_relation?: string | null;
  door_hint?: string | null;
  geom_source?: string | null;
  verified_count?: number | null;
  learned_lat?: number | null;
  learned_lng?: number | null;
  has_voice_note?: boolean | null;
}

/** A real Prisma unique-violation instance — lets `instanceof` checks behave exactly as they would in production. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The customer's own address book (Bloc 8, docs/29). Closes the gap the
 * pre-Bloc-8 audit found: `orders.createOrder` has always READ a default
 * address, but nothing ever let a real (non-seeded) customer CREATE one.
 *
 * Every method takes `userId` as its first argument and scopes its own
 * queries by it — the same ownership discipline as `NotificationsService`
 * (Bloc 7): a row that does not exist and one that belongs to someone else
 * answer the identical 404, and there is no separate `@RequireOwnership`
 * decorator to keep in sync with the service's own logic.
 *
 * `geom geography(Point,4326)` is never modelled on the Prisma `Address`
 * (the established PostGIS convention — docs/17 D-02, same as
 * `couriers.last_geom`/`orders.dropoff_geom`): every read goes through a raw
 * `ST_Y`/`ST_X` projection, every coordinate write through a raw
 * `ST_SetSRID(ST_MakePoint(...))` UPDATE run right after the typed
 * create/update for every other column.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.prisma.$queryRaw<AddressRow[]>`
      SELECT a.id, a.label, a.recipient_phone, a.city_id, c.name AS city_name, a.quartier,
             a.street, a.landmark, a.instructions, a.geocode_status, a.is_default,
             a.created_at, a.updated_at,
             ST_Y(a.geom::geometry) AS lat, ST_X(a.geom::geometry) AS lng,
             a.landmark_id, l.name AS landmark_name, a.landmark_relation, a.door_hint,
             a.geom_source, a.verified_count, ST_Y(a.verified_geom::geometry) AS learned_lat,
             ST_X(a.verified_geom::geometry) AS learned_lng,
             EXISTS (SELECT 1 FROM address_voice_notes v WHERE v.address_id = a.id) AS has_voice_note
      FROM addresses a
      LEFT JOIN cities c ON c.id = a.city_id
      LEFT JOIN landmarks l ON l.id = a.landmark_id
      WHERE a.user_id = ${userId}::uuid
      ORDER BY a.is_default DESC, a.created_at DESC
    `;
    return rows.map(toDto);
  }

  async get(
    userId: string,
    addressId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<AddressDto> {
    const rows = await client.$queryRaw<AddressRow[]>`
      SELECT a.id, a.label, a.recipient_phone, a.city_id, c.name AS city_name, a.quartier,
             a.street, a.landmark, a.instructions, a.geocode_status, a.is_default,
             a.created_at, a.updated_at,
             ST_Y(a.geom::geometry) AS lat, ST_X(a.geom::geometry) AS lng,
             a.landmark_id, l.name AS landmark_name, a.landmark_relation, a.door_hint,
             a.geom_source, a.verified_count, ST_Y(a.verified_geom::geometry) AS learned_lat,
             ST_X(a.verified_geom::geometry) AS learned_lng,
             EXISTS (SELECT 1 FROM address_voice_notes v WHERE v.address_id = a.id) AS has_voice_note
      FROM addresses a
      LEFT JOIN cities c ON c.id = a.city_id
      LEFT JOIN landmarks l ON l.id = a.landmark_id
      WHERE a.id = ${addressId}::uuid AND a.user_id = ${userId}::uuid
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Address not found.' });
    }
    return toDto(row);
  }

  async create(userId: string, input: CreateAddressInput): Promise<AddressDto> {
    if (input.coordinates && !isValidLatLng(input.coordinates)) {
      throw new ConflictException({
        code: 'INVALID_LOCATION',
        message: 'Latitude/longitude out of range.',
      });
    }
    if (input.cityId) await this.assertCityExists(input.cityId);
    const landmark = input.landmarkId ? await this.requireLandmark(input.landmarkId) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      // The first address a user creates becomes their default regardless of
      // the `isDefault` flag — an address book that can reach zero defaults
      // would just re-trigger `createOrder`'s existing guard for no benefit
      // (docs/29 — documented decision, not an accident).
      const existing = await tx.address.count({ where: { userId } });
      const makeDefault = existing === 0 || input.isDefault === true;

      if (makeDefault) {
        // Unset first (same two-step, race-safe-by-row-lock pattern as
        // `setDefault` below) so the partial unique index never sees two
        // `true` rows even transiently within this transaction.
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const row = await tx.address.create({
        data: {
          userId,
          label: input.label ?? null,
          recipientPhone: input.recipientPhone ?? null,
          cityId: input.cityId ?? null,
          quartier: input.quartier ?? null,
          street: input.street ?? null,
          landmark: input.landmark ?? null,
          instructions: input.instructions ?? null,
          // 'ok' only when the caller actually supplied a point — never
          // invented, never geocoded here (no external geocoding call in this
          // bloc, mandate scope). 'manual' mirrors the exact convention
          // `orders.dropoff_geocode_status` already uses for a landmark-only
          // address (docs/09 B.1 — N'Djamena addressing is landmark-first).
          geocodeStatus: input.coordinates || landmark ? 'ok' : 'manual',
          isDefault: makeDefault,
          // FEAT-018
          landmarkId: landmark?.id ?? null,
          landmarkRelation: landmark ? (input.landmarkRelation ?? 'near') : null,
          doorHint: input.doorHint ?? null,
          gpsAccuracyM: input.coordinates ? (input.gpsAccuracyM ?? null) : null,
          geomSource: input.coordinates
            ? input.gpsAccuracyM !== undefined
              ? 'gps'
              : 'user'
            : landmark
              ? 'landmark'
              : 'user',
        },
      });

      if (input.coordinates) {
        await tx.$executeRaw`
          UPDATE addresses SET geom = ST_SetSRID(ST_MakePoint(${input.coordinates.lng}, ${input.coordinates.lat}), 4326)::geography
          WHERE id = ${row.id}::uuid
        `;
      } else if (landmark) {
        // No pin: start from the landmark itself, refined by the first deliveries.
        await tx.$executeRaw`
          UPDATE addresses SET geom = (SELECT geom FROM landmarks WHERE id = ${landmark.id}::uuid)
          WHERE id = ${row.id}::uuid
        `;
      }
      return row;
    });

    return this.get(userId, created.id);
  }

  async update(userId: string, addressId: string, input: UpdateAddressInput): Promise<AddressDto> {
    if (input.coordinates && !isValidLatLng(input.coordinates)) {
      throw new ConflictException({
        code: 'INVALID_LOCATION',
        message: 'Latitude/longitude out of range.',
      });
    }
    if (input.cityId) await this.assertCityExists(input.cityId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id: addressId, userId } });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Address not found.' });
      }

      // Built explicitly, key by key, rather than spreading the Zod-inferred
      // `scalars` object straight into Prisma's input type: under
      // `exactOptionalPropertyTypes`, a `{ field?: string }` whose value is
      // simply ABSENT is not assignable to Prisma's `{ field?: string |
      // undefined }` (the two optionalities are not the same type to the
      // compiler) — the same mismatch `couriers`' location DTO hit (docs/25).
      const { coordinates, ...rest } = input;
      const data: Prisma.AddressUpdateInput = {};
      if (rest.label !== undefined) data.label = rest.label;
      if (rest.recipientPhone !== undefined) data.recipientPhone = rest.recipientPhone;
      if (rest.cityId !== undefined) data.cityId = rest.cityId;
      if (rest.quartier !== undefined) data.quartier = rest.quartier;
      if (rest.street !== undefined) data.street = rest.street;
      if (rest.landmark !== undefined) data.landmark = rest.landmark;
      if (rest.instructions !== undefined) data.instructions = rest.instructions;
      if (rest.landmarkId !== undefined) {
        if (rest.landmarkId !== null) await this.requireLandmark(rest.landmarkId);
        data.landmarkId = rest.landmarkId;
        if (rest.landmarkId === null) data.landmarkRelation = null;
        else if (rest.landmarkRelation === undefined && !existing.landmarkRelation) {
          data.landmarkRelation = 'near';
        }
      }
      if (rest.landmarkRelation !== undefined) data.landmarkRelation = rest.landmarkRelation;
      if (rest.doorHint !== undefined) data.doorHint = rest.doorHint;
      if (coordinates) {
        data.geomSource = rest.gpsAccuracyM !== undefined ? 'gps' : 'user';
        data.gpsAccuracyM = rest.gpsAccuracyM ?? null;
      }
      if (Object.keys(data).length > 0) {
        await tx.address.update({ where: { id: addressId }, data });
      }
      if (coordinates) {
        await tx.$executeRaw`
          UPDATE addresses SET geom = ST_SetSRID(ST_MakePoint(${coordinates.lng}, ${coordinates.lat}), 4326)::geography,
                 geocode_status = 'ok'
          WHERE id = ${addressId}::uuid
        `;
      }
    });

    // Editing a UserAddress NEVER reaches a past order (docs/29): every
    // `orders.dropoff_*` column is a scalar copy frozen at creation, and
    // `dropoffAddressId` is ON DELETE SET NULL (migration 0025) — this method
    // never touches `orders` at all, by construction.
    return this.get(userId, addressId);
  }

  /**
   * Sets one address as the user's default — idempotent (calling it on an
   * already-default address is a harmless no-op) and race-safe. The two-step
   * unset-then-set runs in one transaction; Postgres's own row-level locking
   * on the shared "current default" row serialises two genuinely concurrent
   * callers for the same user (the loser's UPDATE blocks, then re-evaluates
   * against the winner's committed state). `addresses_one_default_per_user`
   * (migration 0027) is the backstop if that reasoning ever has a gap this
   * code did not anticipate — caught below and translated, never a raw 500.
   */
  async setDefault(userId: string, addressId: string): Promise<AddressDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.address.findFirst({ where: { id: addressId, userId } });
        if (!existing) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Address not found.' });
        }
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
        await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'VALIDATION_ERROR',
          message: 'Could not set this address as default — please retry.',
        });
      }
      throw err;
    }
    return this.get(userId, addressId);
  }

  /**
   * Removes an address. Deleting the default auto-promotes the user's most
   * recently created remaining address (docs/29 — the chosen strategy:
   * forbidding deletion would make a default address permanently
   * undeletable, a worse trap than the already-handled "no default" state
   * `createOrder` guards against). Deleting a user's LAST address is allowed
   * outright — they simply return to the already-tested "add one before
   * ordering" state, nothing new to guard.
   */
  async remove(userId: string, addressId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.address.deleteMany({ where: { id: addressId, userId } });
      if (deleted.count === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Address not found.' });
      }

      const stillHasDefault = await tx.address.count({ where: { userId, isDefault: true } });
      if (stillHasDefault > 0) return; // the deleted row was not the default — nothing to promote

      const promoted = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (promoted) {
        await tx.address.update({ where: { id: promoted.id }, data: { isDefault: true } });
      }
    });
  }

  /**
   * For `OrdersService` (Bloc 8, docs/29 §checkout) — resolves and validates
   * a client-selected address without exposing ownership details to a
   * stranger (same 404 for "doesn't exist" and "belongs to someone else" as
   * every other method here). Accepts the caller's own transaction client so
   * the ownership check and the order's address snapshot commit as one
   * atomic unit — no gap where the address could change between the two.
   */
  async requireOwned(
    userId: string,
    addressId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AddressDto> {
    return this.get(userId, addressId, tx ?? this.prisma);
  }

  // ---- FEAT-018 -----------------------------------------------------------

  /** Landmarks of a city, by name or alias (accents and case ignored). */
  async searchLandmarks(query: LandmarkQuery): Promise<LandmarkDto[]> {
    const q = (query.q ?? '').trim();
    const like = `%${q}%`;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; city_id: string; name: string; kind: string; lat: number; lng: number }>
    >`
      SELECT l.id, l.city_id, l.name, l.kind,
             ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lng
      FROM landmarks l
      WHERE l.active
        AND (${query.cityId ?? null}::uuid IS NULL OR l.city_id = ${query.cityId ?? null}::uuid)
        AND (${q} = '' OR unaccent_lower(l.name) LIKE unaccent_lower(${like})
             OR EXISTS (SELECT 1 FROM unnest(l.aliases) x WHERE unaccent_lower(x) LIKE unaccent_lower(${like})))
      ORDER BY l.name
      LIMIT 20
    `;
    return rows.map((r) => ({
      id: r.id,
      cityId: r.city_id,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
    }));
  }

  /** A ≤ 10 s voice note for the courier (replaces the previous one). */
  async setVoiceNote(
    userId: string,
    addressId: string,
    input: VoiceNoteInput,
  ): Promise<AddressDto> {
    await this.get(userId, addressId); // ownership (404)
    const data = Buffer.from(input.dataBase64, 'base64');
    if (data.length === 0 || data.length > MAX_VOICE_NOTE_BYTES) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'The voice note must be 10 seconds and 40 KB at most.',
      });
    }
    await this.prisma.addressVoiceNote.upsert({
      where: { addressId },
      create: { addressId, mime: input.mime, data, durationMs: input.durationMs },
      update: { mime: input.mime, data, durationMs: input.durationMs, createdAt: new Date() },
    });
    return this.get(userId, addressId);
  }

  async removeVoiceNote(userId: string, addressId: string): Promise<void> {
    await this.get(userId, addressId);
    await this.prisma.addressVoiceNote.deleteMany({ where: { addressId } });
  }

  /** The customer's own voice note, to listen back. */
  async getOwnVoiceNote(userId: string, addressId: string) {
    await this.get(userId, addressId);
    return this.getVoiceNote(addressId);
  }

  /**
   * For `orders` (courier access goes through `deliveries` → the order port,
   * which checks the courier is the one delivering this order).
   */
  async getVoiceNote(
    addressId: string,
  ): Promise<{ mime: string; data: Buffer; durationMs: number } | null> {
    const v = await this.prisma.addressVoiceNote.findUnique({ where: { addressId } });
    return v ? { mime: v.mime, data: Buffer.from(v.data), durationMs: v.durationMs } : null;
  }

  /**
   * FEAT-018 (SPEC-018-02): where the courier stood when the delivery was
   * confirmed refines the address's delivery point (`verified_geom`). Pure
   * rule in `@djafat/core`; imprecise or implausible fixes are ignored.
   */
  async learnDeliveryPoint(
    addressId: string,
    fix: { lat: number; lng: number; accuracyM: number | null },
  ): Promise<LearnOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ count: number; lat: number | null; lng: number | null }>
      >`
        SELECT verified_count AS count,
               ST_Y(verified_geom::geometry) AS lat, ST_X(verified_geom::geometry) AS lng
        FROM addresses WHERE id = ${addressId}::uuid FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return { accepted: false as const, reason: 'imprecise' as const };
      const previous =
        row.lat !== null && row.lng !== null && row.count > 0
          ? { lat: row.lat, lng: row.lng, count: row.count }
          : null;
      const outcome = learnDropoffPoint(previous, fix);
      if (outcome.accepted) {
        await tx.$executeRaw`
          UPDATE addresses SET
            verified_geom = ST_SetSRID(ST_MakePoint(${outcome.point.lng}, ${outcome.point.lat}), 4326)::geography,
            verified_count = ${outcome.point.count},
            verified_at = now()
          WHERE id = ${addressId}::uuid
        `;
      }
      return outcome;
    });
  }

  private async requireLandmark(id: string): Promise<{ id: string }> {
    const l = await this.prisma.landmark.findFirst({ where: { id, active: true } });
    if (!l) {
      throw new ConflictException({ code: 'VALIDATION_ERROR', message: `Unknown landmark ${id}.` });
    }
    return { id: l.id };
  }

  private async assertCityExists(cityId: string): Promise<void> {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) {
      throw new ConflictException({ code: 'VALIDATION_ERROR', message: `Unknown city ${cityId}.` });
    }
  }
}

function toDto(row: AddressRow): AddressDto {
  return {
    id: row.id,
    label: row.label,
    recipientPhone: row.recipient_phone,
    cityId: row.city_id,
    cityName: row.city_name,
    quartier: row.quartier,
    street: row.street,
    landmark: row.landmark,
    instructions: row.instructions,
    lat: row.lat,
    lng: row.lng,
    geocodeStatus: row.geocode_status,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...feat018(row),
  };
}

const MAX_VOICE_NOTE_BYTES = 40 * 1024;

function feat018(row: AddressRow) {
  const relation = (row.landmark_relation ?? null) as LandmarkRelation | null;
  const landmarkName = row.landmark_name ?? null;
  const doorHint = row.door_hint ?? null;
  return {
    landmarkId: row.landmark_id ?? null,
    landmarkName,
    landmarkRelation: relation,
    doorHint,
    geomSource: row.geom_source ?? 'user',
    learnedPoint:
      row.learned_lat != null && row.learned_lng != null && (row.verified_count ?? 0) > 0
        ? { lat: row.learned_lat, lng: row.learned_lng, count: row.verified_count ?? 0 }
        : null,
    hasVoiceNote: row.has_voice_note === true,
    deliveryHint: describeDropoff({ relation, landmarkName, doorHint }),
  };
}
