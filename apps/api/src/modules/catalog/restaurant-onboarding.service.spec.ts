import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { RestaurantOnboardingService } from './restaurant-onboarding.service';
import { firstFreeSlug, slugifyRestaurantName } from './restaurant-slug';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-03).

function fakeTx(existingSlugs: string[] = []) {
  const restaurants: Array<Record<string, unknown>> = existingSlugs.map((slug) => ({ slug }));
  const applications: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`lock ${String(values[0])}`);
      return 1;
    }),
    city: {
      findFirstOrThrow: vi.fn(async () => ({ id: 'city-ndj', countryId: 'country-td' })),
    },
    restaurant: {
      findMany: vi.fn(async ({ where }: { where: { slug: { startsWith: string } } }) => {
        calls.push(`read ${where.slug.startsWith}`);
        return restaurants
          .filter((r) => String(r['slug']).startsWith(where.slug.startsWith))
          .map((r) => ({ slug: r['slug'] }));
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r-${restaurants.length + 1}`, ...data };
        restaurants.push(row);
        return { id: row.id };
      }),
    },
    restaurantApplication: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        applications.push(data);
        return data;
      }),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, restaurants, applications, calls };
}

const SIGNUP = {
  restaurantName: 'Chez Fatimé',
  neighbourhoodId: '11111111-1111-4111-8111-111111111111',
  neighbourhoodOther: null,
  termsAcceptedAt: new Date('2026-11-23T09:00:00Z'),
};

describe('SPEC-022-03 — the restaurant created at sign-up', () => {
  // SPEC-022-03-SC01
  it('SPEC-022-03-SC01 — a draft restaurant of N’Djamena in XAF, owned by the account, with an application to complete', async () => {
    const { tx, restaurants, applications } = fakeTx();
    const { restaurantId } = await new RestaurantOnboardingService().provisionRestaurant(
      tx,
      'u-fatime',
      SIGNUP,
    );
    expect(restaurants).toEqual([
      {
        id: restaurantId,
        countryId: 'country-td',
        cityId: 'city-ndj',
        ownerUserId: 'u-fatime',
        slug: 'chez-fatime',
        name: 'Chez Fatimé',
        currency: 'XAF',
        status: 'draft',
        neighbourhoodId: SIGNUP.neighbourhoodId,
        neighbourhoodOther: null,
      },
    ]);
    expect(applications).toEqual([{ restaurantId, termsAcceptedAt: SIGNUP.termsAcceptedAt }]);
  });

  // SPEC-022-03-SC04
  it('SPEC-022-03-SC04 — a second « Chez Fatimé » gets its own address, suffixed, without error', async () => {
    const { tx, restaurants, calls } = fakeTx([
      'chez-fatime',
      'chez-fatime-2',
      'chez-fatime-grill',
    ]);
    await new RestaurantOnboardingService().provisionRestaurant(tx, 'u-other', SIGNUP);
    expect(restaurants.at(-1)?.['slug']).toBe('chez-fatime-3');
    // two at once: the address is locked before the taken ones are read
    expect(calls).toEqual(['lock restaurant-slug:chez-fatime', 'read chez-fatime']);
  });

  it('turns any name into an address: accents, punctuation, length; never empty', () => {
    expect(slugifyRestaurantName('  Le Sahel — Grill & Café ! ')).toBe('le-sahel-grill-cafe');
    expect(slugifyRestaurantName('Chez Fatimé')).toBe('chez-fatime');
    expect(slugifyRestaurantName('!!!')).toBe('restaurant');
    expect(slugifyRestaurantName('a'.repeat(100))).toHaveLength(60);
    expect(firstFreeSlug('pizza', [])).toBe('pizza');
    expect(firstFreeSlug('pizza', ['pizza', 'pizza-2', 'pizza-ndjam'])).toBe('pizza-3');
  });
});

describe('SPEC-022-08 R5 — one restaurant per owner, role revoked or not', () => {
  it('ownsRestaurant reads the restaurants the account owns, inside the transaction', async () => {
    const count = vi.fn(async ({ where }: { where: { ownerUserId: string } }) =>
      where.ownerUserId === 'u-fatime' ? 1 : 0,
    );
    const tx = { restaurant: { count } } as unknown as Prisma.TransactionClient;
    const service = new RestaurantOnboardingService();
    expect(await service.ownsRestaurant(tx, 'u-fatime')).toBe(true);
    expect(await service.ownsRestaurant(tx, 'u-awa')).toBe(false);
  });
});
