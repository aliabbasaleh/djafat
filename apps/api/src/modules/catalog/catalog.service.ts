import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MoneyJson, RestaurantAvailabilityStatus } from '@djafat/types';
import { RESTAURANT_PUBLIC_STATUSES } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { RestaurantAvailabilityService } from './restaurant-availability.service';
import {
  sortRestaurants,
  type RestaurantSortKey,
  type SortableRestaurant,
} from './restaurant-sort';

// ── Bloc 0.5 walking-skeleton reads (unchanged — consumed by `orders`) ──────

export interface RestaurantRecord {
  readonly id: string;
  readonly countryId: string;
  readonly cityId: string;
  readonly name: string;
  readonly currency: string;
}

export interface ProductRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly isAvailable: boolean;
}

// ── Bloc 4 — cart-time product+option reads (docs/22 §4) ────────────────────

export interface CartOptionRecord {
  readonly id: string;
  readonly optionGroupId: string;
  readonly name: string;
  readonly priceDeltaMinor: bigint;
  readonly currency: string;
  readonly isAvailable: boolean;
}

export interface CartOptionGroupRecord {
  readonly id: string;
  readonly selectionType: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly CartOptionRecord[];
}

export interface CartProductRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly optionGroups: readonly CartOptionGroupRecord[];
}

// ── Bloc 2 — public catalogue reads (docs/20) ───────────────────────────────

export interface RestaurantListItemDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly prepTimeMin: number;
  readonly minOrder: MoneyJson;
  readonly availability: RestaurantAvailabilityStatus;
}

export interface RestaurantDetailDto extends RestaurantListItemDto {
  readonly phone: string | null;
  readonly addressText: string | null;
  readonly currency: string;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ListRestaurantsQuery {
  readonly cityId?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly search?: string | undefined;
  readonly openNow?: boolean | undefined;
  readonly sort?: RestaurantSortKey | undefined;
  readonly page: number;
  readonly limit: number;
}

export interface ProductSummaryDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly price: MoneyJson;
  readonly isAvailable: boolean;
  readonly hasOptions: boolean;
}

export interface MenuCategoryDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly products: readonly ProductSummaryDto[];
}

export interface OptionDto {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
  readonly isAvailable: boolean;
}

export interface OptionGroupDto {
  readonly id: string;
  readonly name: string;
  readonly selectionType: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly OptionDto[];
}

export interface ProductDetailDto extends ProductSummaryDto {
  readonly restaurantId: string;
  readonly categoryId: string | null;
  readonly optionGroups: readonly OptionGroupDto[];
}

export interface CategoryOptionDto {
  readonly name: string;
  readonly restaurantCount: number;
}

interface RawRestaurantRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  rating_avg: Prisma.Decimal;
  rating_count: number;
  prep_time_min: number;
  min_order_minor: bigint;
  currency: string;
  status: string;
  phone: string | null;
  address_text: string | null;
  city_timezone: string;
  created_at: Date;
}

/**
 * Reads for the public catalogue (docs/20). `orders` still consumes
 * `getActiveRestaurant`/`getAvailableProducts` unchanged (Bloc 0.5 contract
 * preserved — docs/20 §56). Never exposes a non-public restaurant/product,
 * regardless of what the caller asks for (docs/20 §3, §6).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: RestaurantAvailabilityService,
  ) {}

  async getActiveRestaurant(id: string): Promise<RestaurantRecord> {
    const r = await this.prisma.restaurant.findFirst({ where: { id, status: 'active' } });
    if (!r) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Restaurant ${id} not found.` });
    }
    return {
      id: r.id,
      countryId: r.countryId,
      cityId: r.cityId,
      name: r.name,
      currency: r.currency,
    };
  }

  /**
   * FEAT-017: the restaurant an offline order message names — by its slug,
   * or by the first 8 hex characters of its id (what the app writes when it
   * has no slug at hand). Null when nothing, or more than one, matches.
   */
  async findRestaurantIdByRef(ref: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT r.id FROM restaurants r
      WHERE r.status = ANY(${RESTAURANT_PUBLIC_STATUSES}::text[])
        AND (r.slug = ${ref} OR (${/^[0-9a-f]{8}$/.test(ref)} AND r.id::text LIKE ${`${ref}%`}))
      LIMIT 2
    `);
    return rows.length === 1 ? rows[0]!.id : null;
  }

  /**
   * "Is this restaurant taking orders right now?" for the WRITE paths.
   *
   * `getActiveRestaurant` above only checks the admin-level `status =
   * 'active'` flag — it says nothing about opening hours or exceptional
   * closures, which is exactly the hole the second pilot run fell into
   * (docs/36 §6): the catalogue rendered `CLOSED` from
   * `RestaurantAvailabilityService` while `POST /orders`, which never
   * consulted it, happily accepted the order. Exposed here rather than by
   * exporting `RestaurantAvailabilityService` from `CatalogModule`, so
   * `CatalogService` stays the single catalog↔orders contract surface
   * (docs/20 §56) and the DAG edge count does not grow.
   */
  async getRestaurantAvailability(restaurantId: string): Promise<RestaurantAvailabilityStatus> {
    return this.availability.computeForRestaurant(restaurantId);
  }

  async getAvailableProducts(
    restaurantId: string,
    ids: readonly string[],
  ): Promise<ProductRecord[]> {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...ids] }, restaurantId, isAvailable: true },
    });
    return rows.map((p) => ({
      id: p.id,
      restaurantId: p.restaurantId,
      name: p.name,
      priceMinor: p.priceMinor,
      currency: p.currency,
      isAvailable: p.isAvailable,
    }));
  }

  /**
   * Live product + option-group + option data for the cart module (docs/22
   * §4, §6) — one query for however many product ids `carts`/`orders` needs,
   * never one query per line (a cart typically has a handful of lines, but
   * the discipline is the same one already used for the restaurant list,
   * docs/20 §39). Only products that are still `isActive && isAvailable` are
   * returned at all — an unavailable product is simply absent from the
   * result, exactly like `getAvailableProducts` above (same Bloc 0.5
   * contract, extended with options). The CALLER never trusts a cart's own
   * stored snapshot — this is always a fresh read.
   */
  async getCartEligibleProducts(
    restaurantId: string,
    ids: readonly string[],
  ): Promise<CartProductRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...ids] }, restaurantId, isActive: true, isAvailable: true },
      include: { optionGroups: { include: { options: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      restaurantId: p.restaurantId,
      name: p.name,
      priceMinor: p.priceMinor,
      currency: p.currency,
      optionGroups: p.optionGroups.map((g) => ({
        id: g.id,
        selectionType: g.selectionType,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        isRequired: g.isRequired,
        options: g.options.map((o) => ({
          id: o.id,
          optionGroupId: o.optionGroupId,
          name: o.name,
          priceDeltaMinor: o.priceDeltaMinor,
          currency: o.currency,
          isAvailable: o.isAvailable,
        })),
      })),
    }));
  }

  /**
   * Fetches every publicly-visible restaurant matching the filters (no SQL
   * LIMIT/OFFSET — docs/20 §26-§30), computes availability for the whole
   * set in ONE extra pair of queries (no N+1 regardless of result size —
   * docs/20 §39, §52), then sorts/filters-by-openNow/paginates in memory.
   * Correct at launch-market scale (dozens to low hundreds of restaurants
   * per city); a materialised availability column would be the next step
   * if a market ever grows past that (docs/20 §14 dette).
   */
  async listRestaurants(
    query: ListRestaurantsQuery,
  ): Promise<PaginatedResult<RestaurantListItemDto>> {
    const searchTerm = query.search?.trim();
    const rows = await this.prisma.$queryRaw<RawRestaurantRow[]>(Prisma.sql`
      SELECT r.id, r.slug, r.name, r.description, r.logo_url, r.cover_url,
             r.rating_avg, r.rating_count, r.prep_time_min, r.min_order_minor,
             r.currency, r.status, r.phone, r.address_text, r.created_at,
             c.timezone AS city_timezone
      FROM restaurants r
      JOIN cities c ON c.id = r.city_id
      WHERE r.status = ANY(${RESTAURANT_PUBLIC_STATUSES}::text[])
        AND (${query.cityId ?? null}::uuid IS NULL OR r.city_id = ${query.cityId ?? null}::uuid)
        AND (
          ${query.categoryId ?? null}::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM menu_categories mc
            WHERE mc.restaurant_id = r.id AND mc.id = ${query.categoryId ?? null}::uuid AND mc.is_active
          )
        )
        AND (
          ${searchTerm ?? null}::text IS NULL
          OR r.search_vector @@ websearch_to_tsquery('french', ${searchTerm ?? null})
          -- docs/20 §27: search also matches a PRODUCT or CATEGORY name, not
          -- just the restaurant's own name/description.
          OR EXISTS (
            SELECT 1 FROM products p
            WHERE p.restaurant_id = r.id AND p.is_active
              AND p.search_vector @@ websearch_to_tsquery('french', ${searchTerm ?? null})
          )
          OR EXISTS (
            SELECT 1 FROM menu_categories mc2
            WHERE mc2.restaurant_id = r.id AND mc2.is_active
              AND mc2.name ILIKE '%' || ${searchTerm ?? null} || '%'
          )
        )
    `);

    const withAvailability = await this.attachAvailability(rows);
    const filtered = query.openNow
      ? withAvailability.filter((r) => r.availability === 'OPEN')
      : withAvailability;
    const sorted = sortRestaurants(filtered.map(toSortable), query.sort ?? 'recommended');

    const total = sorted.length;
    const start = (query.page - 1) * query.limit;
    const page = sorted.slice(start, start + query.limit).map((s) => toListItemDto(s.row));

    return {
      items: page,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /**
   * Distinct category names in use across publicly-visible restaurants
   * (docs/20 §11, §24) — `MenuCategory` is restaurant-scoped, so "the list
   * of categories" is necessarily an aggregate, not a lookup of one table.
   * Ordered by how many restaurants carry the name, then alphabetically —
   * deterministic, same principle as `sortRestaurants` (docs/20 §30).
   */
  async listCategories(query: { cityId?: string | undefined }): Promise<CategoryOptionDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; restaurant_count: bigint }>
    >(Prisma.sql`
      SELECT mc.name, COUNT(DISTINCT mc.restaurant_id)::bigint AS restaurant_count
      FROM menu_categories mc
      JOIN restaurants r ON r.id = mc.restaurant_id
      WHERE mc.is_active
        AND r.status = ANY(${RESTAURANT_PUBLIC_STATUSES}::text[])
        AND (${query.cityId ?? null}::uuid IS NULL OR r.city_id = ${query.cityId ?? null}::uuid)
      GROUP BY mc.name
      ORDER BY restaurant_count DESC, mc.name ASC
    `);
    return rows.map((r) => ({ name: r.name, restaurantCount: Number(r.restaurant_count) }));
  }

  async getRestaurantBySlug(slug: string): Promise<RestaurantDetailDto> {
    const rows = await this.prisma.$queryRaw<RawRestaurantRow[]>(Prisma.sql`
      SELECT r.id, r.slug, r.name, r.description, r.logo_url, r.cover_url,
             r.rating_avg, r.rating_count, r.prep_time_min, r.min_order_minor,
             r.currency, r.status, r.phone, r.address_text, r.created_at,
             c.timezone AS city_timezone
      FROM restaurants r
      JOIN cities c ON c.id = r.city_id
      WHERE r.slug = ${slug} AND r.status = ANY(${RESTAURANT_PUBLIC_STATUSES}::text[])
    `);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Restaurant "${slug}" not found.`,
      });
    }
    const [withAvailability] = await this.attachAvailability([row]);
    return {
      ...toListItemDto(withAvailability!),
      phone: row.phone,
      addressText: row.address_text,
      currency: row.currency,
    };
  }

  /** Only categories/products that are ACTIVE — `isActive=false` never leaves the catalogue module (docs/20 §19). */
  async getMenu(restaurantId: string): Promise<MenuCategoryDto[]> {
    await this.assertRestaurantPublic(restaurantId);
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { optionGroups: true } } },
        },
      },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      sortOrder: c.sortOrder,
      products: c.products.map((p) => toProductSummary(p, p._count.optionGroups > 0)),
    }));
  }

  async getProductDetail(productId: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      include: {
        optionGroups: {
          orderBy: { sortOrder: 'asc' },
          include: { options: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!product) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Product ${productId} not found.`,
      });
    }
    await this.assertRestaurantPublic(product.restaurantId);

    return {
      ...toProductSummary(product, product.optionGroups.length > 0),
      restaurantId: product.restaurantId,
      categoryId: product.categoryId,
      optionGroups: product.optionGroups.map((g) => ({
        id: g.id,
        name: g.name,
        selectionType: g.selectionType,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        isRequired: g.isRequired,
        options: g.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: toMoneyJson(o.priceDeltaMinor, o.currency),
          isAvailable: o.isAvailable,
        })),
      })),
    };
  }

  private async assertRestaurantPublic(restaurantId: string): Promise<void> {
    const r = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, status: { in: [...RESTAURANT_PUBLIC_STATUSES] } },
      select: { id: true },
    });
    if (!r) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Restaurant ${restaurantId} not found.`,
      });
    }
  }

  private async attachAvailability(
    rows: readonly RawRestaurantRow[],
  ): Promise<Array<RawRestaurantRow & { availability: RestaurantAvailabilityStatus }>> {
    const availabilityByRestaurant = await this.availability.computeForRestaurants(
      rows.map((r) => ({ id: r.id, status: r.status, timezone: r.city_timezone })),
    );
    return rows.map((r) => ({
      ...r,
      availability: availabilityByRestaurant.get(r.id) ?? 'UNAVAILABLE',
    }));
  }
}

function toListItemDto(
  row: RawRestaurantRow & { availability: RestaurantAvailabilityStatus },
): RestaurantListItemDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logoUrl: row.logo_url,
    coverUrl: row.cover_url,
    ratingAvg: row.rating_avg.toNumber(),
    ratingCount: row.rating_count,
    prepTimeMin: row.prep_time_min,
    minOrder: toMoneyJson(row.min_order_minor, row.currency),
    availability: row.availability,
  };
}

function toProductSummary(
  p: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    priceMinor: bigint;
    currency: string;
    isAvailable: boolean;
  },
  hasOptions: boolean,
): ProductSummaryDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    price: toMoneyJson(p.priceMinor, p.currency),
    isAvailable: p.isAvailable,
    hasOptions,
  };
}

/** `raw_snake_case` row -> the shape `sortRestaurants` needs, keeping the original row attached for later DTO mapping. */
function toSortable(
  row: RawRestaurantRow & { availability: RestaurantAvailabilityStatus },
): SortableRestaurant & { row: RawRestaurantRow & { availability: RestaurantAvailabilityStatus } } {
  return {
    ratingAvg: row.rating_avg.toNumber(),
    ratingCount: row.rating_count,
    prepTimeMin: row.prep_time_min,
    name: row.name,
    createdAt: row.created_at,
    availability: row.availability,
    row,
  };
}
