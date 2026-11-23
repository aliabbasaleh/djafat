import { Injectable } from '@nestjs/common';
import { LAUNCH_MARKET } from '@djafat/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';

/** A row of the admin's queue (SPEC-022-07 R1). */
export interface RestaurantApplicationQueueRow {
  readonly id: string;
  readonly name: string;
  readonly neighbourhood: string | null;
  readonly submittedAt: string;
}

/**
 * FEAT-022 (SPEC-022-05, SPEC-022-07 for restaurants): a restaurant's
 * application. This part only lists the ones waiting for DJAFAT, for the
 * admin's queue; the owner's four steps and DJAFAT's decisions on a
 * restaurant come with SPEC-022-05 (docs/features/FEAT-022-*, part 3).
 */
@Injectable()
export class RestaurantApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neighbourhoods: NeighbourhoodsService,
  ) {}

  /** SPEC-022-07 R1: the applications waiting for DJAFAT, oldest first — never a draft. */
  async listPendingForReview(): Promise<RestaurantApplicationQueueRow[]> {
    const rows = await this.prisma.restaurantApplication.findMany({
      where: { status: 'pending_review' },
      orderBy: { submittedAt: 'asc' },
      select: { restaurantId: true, submittedAt: true },
    });
    if (rows.length === 0) return [];
    const [restaurants, all] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: { id: { in: rows.map((r) => r.restaurantId) } },
        select: { id: true, name: true, neighbourhoodId: true, neighbourhoodOther: true },
      }),
      this.neighbourhoods.listAll(LAUNCH_MARKET.citySlug),
    ]);
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const names = new Map(all.map((n) => [n.id, n.name]));
    return rows.flatMap((row) => {
      const restaurant = byId.get(row.restaurantId);
      if (!restaurant) return [];
      return [
        {
          id: restaurant.id,
          name: restaurant.name,
          neighbourhood:
            (restaurant.neighbourhoodId ? names.get(restaurant.neighbourhoodId) : null) ??
            restaurant.neighbourhoodOther ??
            null,
          submittedAt: (row.submittedAt ?? new Date(0)).toISOString(),
        },
      ];
    });
  }
}
