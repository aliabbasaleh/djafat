import { describe, expect, it } from 'vitest';
import { sortRestaurants, type SortableRestaurant } from './restaurant-sort';

const r = (overrides: Partial<SortableRestaurant> & { name: string }): SortableRestaurant => ({
  ratingAvg: 0,
  ratingCount: 0,
  prepTimeMin: 20,
  createdAt: new Date('2026-01-01'),
  availability: 'OPEN',
  ...overrides,
});

describe('sortRestaurants', () => {
  it('recommended: higher rating first', () => {
    const a = r({ name: 'A', ratingAvg: 4.2 });
    const b = r({ name: 'B', ratingAvg: 4.8 });
    expect(sortRestaurants([a, b], 'recommended').map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('recommended: equal rating -> higher review volume wins', () => {
    const a = r({ name: 'A', ratingAvg: 4.8, ratingCount: 3 });
    const b = r({ name: 'B', ratingAvg: 4.8, ratingCount: 200 });
    expect(sortRestaurants([a, b], 'recommended').map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('recommended: equal rating AND volume -> older listing wins (deterministic final tie-break)', () => {
    const a = r({ name: 'A', ratingAvg: 4.5, ratingCount: 10, createdAt: new Date('2026-03-01') });
    const b = r({ name: 'B', ratingAvg: 4.5, ratingCount: 10, createdAt: new Date('2026-01-01') });
    expect(sortRestaurants([a, b], 'recommended').map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('recommended: is a pure total order — sorting twice gives the same result', () => {
    const items = [
      r({ name: 'A', ratingAvg: 4.5 }),
      r({ name: 'B', ratingAvg: 4.5 }),
      r({ name: 'C', ratingAvg: 4.9 }),
    ];
    const first = sortRestaurants(items, 'recommended').map((x) => x.name);
    const second = sortRestaurants(items, 'recommended').map((x) => x.name);
    expect(first).toEqual(second);
  });

  it('rating: highest average first, ignoring prep time/name', () => {
    const a = r({ name: 'Z', ratingAvg: 4.9, prepTimeMin: 60 });
    const b = r({ name: 'A', ratingAvg: 3.0, prepTimeMin: 5 });
    expect(sortRestaurants([a, b], 'rating').map((x) => x.name)).toEqual(['Z', 'A']);
  });

  it('delivery_time: shortest prep time first', () => {
    const slow = r({ name: 'Slow', prepTimeMin: 45 });
    const fast = r({ name: 'Fast', prepTimeMin: 15 });
    expect(sortRestaurants([slow, fast], 'delivery_time').map((x) => x.name)).toEqual([
      'Fast',
      'Slow',
    ]);
  });

  it('name: alphabetical, French locale-aware (accents sort near their base letter)', () => {
    const items = [r({ name: 'Zèbre' }), r({ name: 'Ananas' }), r({ name: 'Écrevisse' })];
    expect(sortRestaurants(items, 'name').map((x) => x.name)).toEqual([
      'Ananas',
      'Écrevisse',
      'Zèbre',
    ]);
  });

  it('never mutates the input array', () => {
    const items = [r({ name: 'B', ratingAvg: 1 }), r({ name: 'A', ratingAvg: 5 })];
    const original = [...items];
    sortRestaurants(items, 'recommended');
    expect(items).toEqual(original);
  });

  it('handles an empty list', () => {
    expect(sortRestaurants([], 'recommended')).toEqual([]);
  });

  describe('orderable restaurants always outrank non-orderable ones', () => {
    it('recommended: a lower-rated OPEN restaurant beats a higher-rated CLOSED one', () => {
      const closedStar = r({ name: 'ClosedStar', ratingAvg: 4.9, availability: 'CLOSED' });
      const openAverage = r({ name: 'OpenAverage', ratingAvg: 3.1, availability: 'OPEN' });
      expect(sortRestaurants([closedStar, openAverage], 'recommended').map((x) => x.name)).toEqual([
        'OpenAverage',
        'ClosedStar',
      ]);
    });

    it('delivery_time: a slow OPEN restaurant beats a fast PAUSED one', () => {
      const pausedFast = r({ name: 'PausedFast', prepTimeMin: 5, availability: 'PAUSED' });
      const openSlow = r({ name: 'OpenSlow', prepTimeMin: 60, availability: 'OPEN' });
      expect(sortRestaurants([pausedFast, openSlow], 'delivery_time').map((x) => x.name)).toEqual([
        'OpenSlow',
        'PausedFast',
      ]);
    });

    it('name: alphabetical order applies within each group, never across them', () => {
      const items = [
        r({ name: 'Ananas', availability: 'UNAVAILABLE' }),
        r({ name: 'Zèbre', availability: 'OPEN' }),
        r({ name: 'Banane', availability: 'CLOSED' }),
        r({ name: 'Mangue', availability: 'OPEN' }),
      ];
      expect(sortRestaurants(items, 'name').map((x) => x.name)).toEqual([
        'Mangue',
        'Zèbre',
        'Ananas',
        'Banane',
      ]);
    });

    it('CLOSED, PAUSED and UNAVAILABLE rank equally — their own sort order decides', () => {
      const items = [
        r({ name: 'Unavailable', ratingAvg: 4.0, availability: 'UNAVAILABLE' }),
        r({ name: 'Paused', ratingAvg: 4.5, availability: 'PAUSED' }),
        r({ name: 'Closed', ratingAvg: 4.2, availability: 'CLOSED' }),
      ];
      expect(sortRestaurants(items, 'rating').map((x) => x.name)).toEqual([
        'Paused',
        'Closed',
        'Unavailable',
      ]);
    });
  });
});
