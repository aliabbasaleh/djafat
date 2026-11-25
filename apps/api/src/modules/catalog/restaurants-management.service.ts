import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MoneyJson, RestaurantAvailabilityStatus, RestaurantStatus } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { UsersService } from '../users/users.service';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import { slugify } from './slugify';
import type {
  CreateRestaurantInput,
  UpdateRestaurantInput,
} from './dto/restaurant-management.schema';
import type { ReplaceRestaurantHoursInput } from './dto/restaurant-hours.schema';

/** Statuses an owner may set themselves — anything else needs `admin:write` (docs/20 §6, §35). */
const OWNER_SELF_SERVICE_STATUSES: readonly RestaurantStatus[] = ['draft', 'active', 'paused'];

/**
 * FEAT-022 (SPEC-022-03 R3, SPEC-022-07 R3): statuses customers see. A restaurant that
 * signed up reaches them only through DJAFAT's approval, never by its owner's hand
 * (found by the FEAT-022 review: « Fermer maintenant » then « Rouvrir » published it).
 */
const PUBLIC_STATUSES: readonly RestaurantStatus[] = ['active', 'paused'];

export interface RestaurantAdminDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly ownerUserId: string | null;
}

export interface RestaurantHoursWindowDto {
  readonly weekday: number;
  readonly opensMinutes: number;
  readonly closesMinutes: number;
}

export interface RestaurantProfileDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly phone: string | null;
  readonly addressText: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly currency: string;
  readonly status: string;
  readonly prepTimeMin: number;
  readonly minOrder: MoneyJson;
  readonly cityTimezone: string;
  readonly availability: RestaurantAvailabilityStatus;
  readonly hours: readonly RestaurantHoursWindowDto[];
}

/**
 * Restaurant profile CRUD (docs/20 §5, §10, §35).
 *
 * Authorization — who may manage THIS restaurant — is `assertCanManage`
 * (Bloc 9.1, docs/31 §restaurant-ownership): the single source of truth is
 * `user_roles.scope_restaurant_id` (`restaurant_owner`/`restaurant_staff`,
 * `UsersService.isMemberOfRestaurant`), the SAME mechanism `orders.confirm/
 * ready/reject` and `restaurants/me/balance` already use (Bloc 9). This
 * closes the Bloc 9 docs/30 §6 debt: `Restaurant.ownerUserId` used to be a
 * SECOND, competing authorization source (Bloc 1-era `@RequireOwnership`),
 * which meant a `restaurant_staff` member could confirm orders and read
 * their balance but could not touch the menu they're staffing.
 * `ownerUserId` itself is NOT removed — it stays as catalog metadata (which
 * account registered the restaurant, shown in the admin listing), a
 * genuinely different notion from "who currently has RBAC authority",
 * which is exactly what `user_roles` already models (grantable, revocable,
 * audited, DB-constrained to one restaurant per staff member).
 */
@Injectable()
export class RestaurantsManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly availability: RestaurantAvailabilityService,
  ) {}

  /**
   * "My restaurant's" own profile (Bloc 10, docs/33 §profile) — the ONE
   * restaurant `restaurant_owner`/`restaurant_staff` manages, resolved from
   * `user_roles` scope (`UsersService.getRestaurantScope`, same grant
   * `restaurants/me/balance` already relies on, Bloc 9). Unlike `getByIdOrThrow`
   * (used by `assertCanManage` for the `/restaurants/:id/...` routes, where the
   * id is client-supplied and membership must be CHECKED), there is nothing to
   * check here — resolving the scope IS the authorization: an actor can only
   * ever be handed their own restaurant's id.
   *
   * Returns the full profile INCLUDING the live `availability` (`OPEN` /
   * `CLOSED` / `PAUSED` / `UNAVAILABLE`, `RestaurantAvailabilityService`,
   * Bloc 2) — the one piece of state no form field says directly; "close now"
   * is `update({ status: 'paused' })`, already self-service (see `update`
   * below), re-using the existing status machinery rather than inventing a
   * second on/off switch.
   */
  async getMine(actorUserId: string): Promise<RestaurantProfileDto> {
    const restaurantId = await this.users.getRestaurantScope(actorUserId);
    if (!restaurantId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No restaurant is scoped to this account.',
      });
    }
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { hours: true, city: { select: { timezone: true } } },
    });
    const availability = await this.availability.computeForRestaurant(restaurantId);
    return this.toProfileDto(restaurant, availability);
  }

  /**
   * Replaces the caller's OWN weekly opening-hours grid (Bloc 10, docs/33
   * §hours) — delete-then-recreate inside one transaction, so a reader never
   * observes a half-replaced week. Gated at the controller by
   * `restaurants:write` (owner tier — `restaurant_staff` holds `menus:write`
   * but not `restaurants:write`, same boundary `update`'s `status` field
   * already enforces for self-service restaurant-level settings).
   */
  async replaceHours(
    actorUserId: string,
    input: ReplaceRestaurantHoursInput,
  ): Promise<readonly RestaurantHoursWindowDto[]> {
    const restaurantId = await this.users.getRestaurantScope(actorUserId);
    if (!restaurantId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No restaurant is scoped to this account.',
      });
    }
    // FEAT-022 (SPEC-022-05 R5): not while DJAFAT checks the application (the
    // menu stays editable: nothing is visible to customers yet, FEAT-022-Q18).
    const application = await this.prisma.restaurantApplication.findUnique({
      where: { restaurantId },
      select: { status: true },
    });
    if (application?.status === 'pending_review') {
      throw new ConflictException({
        code: 'APPLICATION_LOCKED',
        message: 'Votre dossier est en vérification : il ne se modifie plus pour le moment.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.restaurantHours.deleteMany({ where: { restaurantId } }),
      this.prisma.restaurantHours.createMany({
        data: input.hours.map((h) => ({
          restaurantId,
          weekday: h.weekday,
          opensMinutes: h.opensMinutes,
          closesMinutes: h.closesMinutes,
        })),
      }),
    ]);
    await this.audit.log({
      actorUserId,
      action: 'RESTAURANT_HOURS_REPLACED',
      entityType: 'restaurant',
      entityId: restaurantId,
      after: { windowCount: input.hours.length },
    });
    return input.hours;
  }

  /**
   * The ONE authorization check every restaurant-scoped write in this
   * module goes through (directly, or via the other two catalog services
   * below) — admin tier always passes; otherwise the actor must hold
   * `restaurant_owner`/`restaurant_staff` scoped to THIS restaurant.
   * Returns the restaurant row so callers that already need it (`update`)
   * don't pay for a second query.
   */
  async assertCanManage(
    actorUserId: string,
    restaurantId: string,
    isAdminTier: boolean,
  ): Promise<{ status: string; ownerUserId: string | null }> {
    const restaurant = await this.getByIdOrThrow(restaurantId);
    if (!isAdminTier) {
      const isMember = await this.users.isMemberOfRestaurant(actorUserId, restaurantId);
      if (!isMember) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not belong to this restaurant.',
        });
      }
    }
    return restaurant;
  }

  async create(actorUserId: string, input: CreateRestaurantInput): Promise<RestaurantAdminDto> {
    const city = await this.prisma.city.findUnique({
      where: { id: input.cityId },
      include: { country: true },
    });
    if (!city) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `City ${input.cityId} not found.`,
      });
    }

    const slug = await this.generateUniqueSlug(input.name);
    const restaurant = await this.prisma.restaurant.create({
      data: {
        countryId: city.countryId,
        cityId: city.id,
        ownerUserId: actorUserId,
        slug,
        name: input.name,
        currency: city.country.currency, // server-resolved — never client-supplied (docs/20 §14)
        status: 'draft',
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
      },
    });

    await this.audit.log({
      actorUserId,
      action: 'RESTAURANT_CREATED',
      entityType: 'restaurant',
      entityId: restaurant.id,
      after: { name: restaurant.name, status: restaurant.status },
    });
    return this.toAdminDto(restaurant);
  }

  async update(
    actorUserId: string,
    restaurantId: string,
    input: UpdateRestaurantInput,
    isAdminTier: boolean,
  ): Promise<RestaurantAdminDto> {
    const before = await this.assertCanManage(actorUserId, restaurantId, isAdminTier);

    if (
      input.status !== undefined &&
      !isAdminTier &&
      !OWNER_SELF_SERVICE_STATUSES.includes(input.status)
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Setting status "${input.status}" requires admin:write.`,
      });
    }
    const goesPublic = input.status !== undefined && PUBLIC_STATUSES.includes(input.status);
    // FEAT-022 (SPEC-022-05 R5): the address and the photos are steps 1 and 3.
    const touchesSteps =
      input.addressText !== undefined ||
      input.logoUrl !== undefined ||
      input.coverUrl !== undefined;
    if (!isAdminTier && (goesPublic || touchesSteps)) {
      // No application: created by the team, works as before FEAT-022.
      const application = await this.prisma.restaurantApplication.findUnique({
        where: { restaurantId },
        select: { status: true },
      });
      if (touchesSteps && application?.status === 'pending_review') {
        throw new ConflictException({
          code: 'APPLICATION_LOCKED',
          message: 'Votre dossier est en vérification : il ne se modifie plus pour le moment.',
        });
      }
      if (goesPublic && application && application.status !== 'approved') {
        throw new ConflictException({
          code: 'RESTAURANT_NOT_APPROVED',
          message: "Votre restaurant n'est pas encore validé par DJAFAT.",
        });
      }
    }

    const updated = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
        ...(input.prepTimeMin !== undefined ? { prepTimeMin: input.prepTimeMin } : {}),
        ...(input.minOrderMinor !== undefined ? { minOrderMinor: input.minOrderMinor } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await this.audit.log({
      actorUserId,
      action: 'RESTAURANT_UPDATED',
      entityType: 'restaurant',
      entityId: restaurantId,
      before: { status: before.status },
      after: { status: updated.status },
    });
    return this.toAdminDto(updated);
  }

  /** Minimal admin listing (Bloc 9, docs/30 §admin-api) — never the customer-facing `listRestaurants` (that one filters to public statuses, computes availability/search-rank; an admin needs to see EVERY status, including `paused`/`suspended`). */
  async listForAdmin(
    search: string | undefined,
    status: RestaurantStatus | undefined,
    page: number,
    limit: number,
  ): Promise<{ items: RestaurantAdminDto[]; page: number; limit: number; total: number }> {
    const where = {
      ...(status ? { status } : {}),
      ...(search?.trim()
        ? { name: { contains: search.trim(), mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.restaurant.count({ where }),
    ]);
    return { items: rows.map((r) => this.toAdminDto(r)), page, limit, total };
  }

  private async getByIdOrThrow(
    id: string,
  ): Promise<{ status: string; ownerUserId: string | null }> {
    const r = await this.prisma.restaurant.findUnique({
      where: { id },
      select: { status: true, ownerUserId: true },
    });
    if (!r)
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Restaurant ${id} not found.` });
    return r;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const existing = await this.prisma.restaurant.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
    }
    throw new ConflictException({
      code: 'VALIDATION_ERROR',
      message: 'Could not generate a unique slug.',
    });
  }

  private toAdminDto(r: {
    id: string;
    slug: string;
    name: string;
    status: string;
    ownerUserId: string | null;
  }): RestaurantAdminDto {
    return { id: r.id, slug: r.slug, name: r.name, status: r.status, ownerUserId: r.ownerUserId };
  }

  private toProfileDto(
    r: {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      phone: string | null;
      addressText: string | null;
      logoUrl: string | null;
      coverUrl: string | null;
      currency: string;
      status: string;
      prepTimeMin: number;
      minOrderMinor: bigint;
      city: { timezone: string };
      hours: Array<{ weekday: number; opensMinutes: number; closesMinutes: number }>;
    },
    availability: RestaurantAvailabilityStatus,
  ): RestaurantProfileDto {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      phone: r.phone,
      addressText: r.addressText,
      logoUrl: r.logoUrl,
      coverUrl: r.coverUrl,
      currency: r.currency,
      status: r.status,
      prepTimeMin: r.prepTimeMin,
      minOrder: toMoneyJson(r.minOrderMinor, r.currency),
      cityTimezone: r.city.timezone,
      availability,
      hours: r.hours.map((h) => ({
        weekday: h.weekday,
        opensMinutes: h.opensMinutes,
        closesMinutes: h.closesMinutes,
      })),
    };
  }
}
