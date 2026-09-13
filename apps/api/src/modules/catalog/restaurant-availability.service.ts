import { Injectable } from '@nestjs/common';
import type { RestaurantAvailabilityStatus } from '@djafat/types';
import {
  computeRestaurantAvailability,
  type RestaurantClosureLike,
  type RestaurantHoursLike,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * "Is this restaurant open right now?" (docs/20 §23) — the ONLY place that
 * answers this question; the frontend never recomputes it. Delegates the
 * actual decision to `computeRestaurantAvailability` (`@djafat/core`, pure,
 * 17 tests) — this service only does the I/O: read status/hours/closures/
 * timezone, hand them to the pure function.
 */
@Injectable()
export class RestaurantAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async computeForRestaurant(restaurantId: string): Promise<RestaurantAvailabilityStatus> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { status: true, city: { select: { timezone: true } } },
    });
    const [hours, closures] = await Promise.all([
      this.loadHours(restaurantId),
      this.loadClosures(restaurantId),
    ]);
    return computeRestaurantAvailability({
      status: restaurant.status as never,
      hours,
      closures,
      nowUtc: new Date(),
      timezone: restaurant.city.timezone,
    });
  }

  /**
   * Batch version — avoids N+1 when rendering a restaurant LIST (docs/20
   * §39, §52): one query for hours, one for closures, computed in memory.
   */
  async computeForRestaurants(
    restaurants: readonly { id: string; status: string; timezone: string }[],
  ): Promise<Map<string, RestaurantAvailabilityStatus>> {
    const ids = restaurants.map((r) => r.id);
    if (ids.length === 0) return new Map();

    const [allHours, allClosures] = await Promise.all([
      this.prisma.restaurantHours.findMany({ where: { restaurantId: { in: ids } } }),
      this.prisma.restaurantClosure.findMany({ where: { restaurantId: { in: ids } } }),
    ]);
    const hoursByRestaurant = groupBy(allHours, (h) => h.restaurantId);
    const closuresByRestaurant = groupBy(allClosures, (c) => c.restaurantId);
    const nowUtc = new Date();

    const result = new Map<string, RestaurantAvailabilityStatus>();
    for (const r of restaurants) {
      const hours = (hoursByRestaurant.get(r.id) ?? []).map(toHoursLike);
      const closures = (closuresByRestaurant.get(r.id) ?? []).map(toClosureLike);
      result.set(
        r.id,
        computeRestaurantAvailability({
          status: r.status as never,
          hours,
          closures,
          nowUtc,
          timezone: r.timezone,
        }),
      );
    }
    return result;
  }

  private async loadHours(restaurantId: string): Promise<RestaurantHoursLike[]> {
    const rows = await this.prisma.restaurantHours.findMany({ where: { restaurantId } });
    return rows.map(toHoursLike);
  }

  private async loadClosures(restaurantId: string): Promise<RestaurantClosureLike[]> {
    const rows = await this.prisma.restaurantClosure.findMany({ where: { restaurantId } });
    return rows.map(toClosureLike);
  }
}

function toHoursLike(h: {
  weekday: number;
  opensMinutes: number;
  closesMinutes: number;
}): RestaurantHoursLike {
  return { weekday: h.weekday, opensMinutes: h.opensMinutes, closesMinutes: h.closesMinutes };
}

function toClosureLike(c: { startsAt: Date; endsAt: Date }): RestaurantClosureLike {
  return { startsAt: c.startsAt, endsAt: c.endsAt };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}
