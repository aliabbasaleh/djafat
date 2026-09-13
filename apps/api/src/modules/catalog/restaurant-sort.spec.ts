import { describe, expect, it } from 'vitest';
import { sortRestaurants, type SortableRestaurant } from './restaurant-sort';

const r = (overrides: Partial<SortableRestaurant> & { name: string }): SortableRestaurant => ({
  ratingAvg: 0,
  ratingCount: 0,
  prepTimeMin: 20,
  createdAt: new Date('2026-01-01'),
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
});
