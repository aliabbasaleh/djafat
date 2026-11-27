import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LAUNCH_MARKET } from '@djafat/config';
import type {
  RestaurantOnboardingPort,
  RestaurantSignupRecord,
} from '../../common/ports/account-onboarding.port';
import { firstFreeSlug, slugifyRestaurantName } from './restaurant-slug';

/**
 * FEAT-022 (SPEC-022-03 R2, R3): a restaurant signed up by its owner exists, in
 * the sign-up's transaction, as a `draft` restaurant of N'Djamena in XAF —
 * invisible to customers (only `active` is listed, docs/20 §6) — owned by the
 * account, with an application `to_complete`. One owner, one restaurant (Q06).
 */
@Injectable()
export class RestaurantOnboardingService implements RestaurantOnboardingPort {
  async ownsRestaurant(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    return (await tx.restaurant.count({ where: { ownerUserId: userId } })) > 0;
  }

  async provisionRestaurant(
    tx: Prisma.TransactionClient,
    userId: string,
    signup: RestaurantSignupRecord,
  ): Promise<{ restaurantId: string }> {
    const city = await tx.city.findFirstOrThrow({
      where: { slug: LAUNCH_MARKET.citySlug },
      select: { id: true, countryId: true },
    });
    const base = slugifyRestaurantName(signup.restaurantName);
    // Two « Chez Fatimé » signing up at once: the second waits for the first's address
    // (held until the sign-up's transaction ends), then takes the next suffix (SPEC-022-03-SC04).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant-slug:${base}`}))`;
    const taken = await tx.restaurant.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const restaurant = await tx.restaurant.create({
      data: {
        countryId: city.countryId,
        cityId: city.id,
        ownerUserId: userId,
        slug: firstFreeSlug(
          base,
          taken.map((r) => r.slug),
        ),
        name: signup.restaurantName,
        currency: LAUNCH_MARKET.currency,
        status: 'draft',
        neighbourhoodId: signup.neighbourhoodId,
        neighbourhoodOther: signup.neighbourhoodOther,
      },
      select: { id: true },
    });
    await tx.restaurantApplication.create({
      data: { restaurantId: restaurant.id, termsAcceptedAt: signup.termsAcceptedAt },
    });
    return { restaurantId: restaurant.id };
  }
}
