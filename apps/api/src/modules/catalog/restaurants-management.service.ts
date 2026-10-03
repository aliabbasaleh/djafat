import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RestaurantStatus } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';
import { slugify } from './slugify';
import type {
  CreateRestaurantInput,
  UpdateRestaurantInput,
} from './dto/restaurant-management.schema';

/** Statuses an owner may set themselves — anything else needs `admin:write` (docs/20 §6, §35). */
const OWNER_SELF_SERVICE_STATUSES: readonly RestaurantStatus[] = ['draft', 'active', 'paused'];

export interface RestaurantAdminDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly ownerUserId: string | null;
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
  ) {}

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
}
