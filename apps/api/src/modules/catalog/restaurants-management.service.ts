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
 * Restaurant profile CRUD (docs/20 §5, §10, §35) — ownership resolved via
 * `Restaurant.ownerUserId` (the single-owner model the Bloc 1 `@RequireOwnership`
 * guard already supports; multi-staff-per-restaurant is dette, docs/20 §14).
 */
@Injectable()
export class RestaurantsManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    const before = await this.getByIdOrThrow(restaurantId);

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

  /** For `@RequireOwnership(...)` — throws NotFound itself, never a sentinel (docs/19 §21). */
  async getOwnerUserId(restaurantId: string): Promise<string> {
    const r = await this.getByIdOrThrow(restaurantId);
    // A restaurant with no owner (created before Bloc 2, or admin-created)
    // can only ever be managed via the admin:write override — no plain user
    // id will ever match `null`.
    return r.ownerUserId ?? '00000000-0000-0000-0000-000000000000';
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
