import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

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

/**
 * Minimal catalog reads for the Bloc 0.5 walking skeleton (docs/18 §2).
 * Full catalog (categories, options, search, hours) is Bloc 2 — docs/05 §5.2.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
}
