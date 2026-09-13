import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ListRestaurantsQuerySchema } from './list-restaurants.schema';

describe('ListRestaurantsQuerySchema (docs/20 §28 — search security)', () => {
  it('applies defaults when nothing is provided', () => {
    const parsed = ListRestaurantsQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20 });
  });

  it('rejects an empty search string (min length 1)', () => {
    expect(() => ListRestaurantsQuerySchema.parse({ search: '' })).toThrow(ZodError);
  });

  it('rejects a search string over 80 characters (oversized query)', () => {
    const tooLong = 'a'.repeat(81);
    expect(() => ListRestaurantsQuerySchema.parse({ search: tooLong })).toThrow(ZodError);
  });

  it('accepts a search string at exactly the 80-character limit', () => {
    const atLimit = 'a'.repeat(80);
    expect(ListRestaurantsQuerySchema.parse({ search: atLimit }).search).toBe(atLimit);
  });

  it('accepts unicode search terms (French accents, Arabic script)', () => {
    expect(ListRestaurantsQuerySchema.parse({ search: 'poulet braisé' }).search).toBe(
      'poulet braisé',
    );
    expect(ListRestaurantsQuerySchema.parse({ search: 'مطعم' }).search).toBe('مطعم');
  });

  it('accepts SQL-injection-LOOKING text as an ordinary string (parameterised downstream, never concatenated)', () => {
    const attempt = "'; DROP TABLE restaurants; --";
    const parsed = ListRestaurantsQuerySchema.parse({ search: attempt });
    expect(parsed.search).toBe(attempt); // passed through as data, not executed — see catalog.service.ts's Prisma.sql usage
  });

  it('trims surrounding whitespace', () => {
    expect(ListRestaurantsQuerySchema.parse({ search: '  pizza  ' }).search).toBe('pizza');
  });

  it('rejects a non-UUID cityId/categoryId', () => {
    expect(() => ListRestaurantsQuerySchema.parse({ cityId: 'not-a-uuid' })).toThrow(ZodError);
    expect(() => ListRestaurantsQuerySchema.parse({ categoryId: 'not-a-uuid' })).toThrow(ZodError);
  });

  it('openNow: only the literal strings "true"/"false" are accepted, never truthy coercion', () => {
    expect(ListRestaurantsQuerySchema.parse({ openNow: 'true' }).openNow).toBe(true);
    expect(ListRestaurantsQuerySchema.parse({ openNow: 'false' }).openNow).toBe(false);
    // The classic Zod/JS coercion trap: Boolean("false") === true. Reject anything else outright.
    expect(() => ListRestaurantsQuerySchema.parse({ openNow: 'yes' })).toThrow(ZodError);
    expect(() => ListRestaurantsQuerySchema.parse({ openNow: '0' })).toThrow(ZodError);
  });

  it('rejects an unknown sort key', () => {
    expect(() => ListRestaurantsQuerySchema.parse({ sort: 'popularity' })).toThrow(ZodError);
  });

  it('page/limit: coerced from query-string values, bounded (pagination abuse — docs/20 §51)', () => {
    expect(ListRestaurantsQuerySchema.parse({ page: '3', limit: '10' })).toEqual({
      page: 3,
      limit: 10,
    });
    expect(() => ListRestaurantsQuerySchema.parse({ page: '0' })).toThrow(ZodError);
    expect(() => ListRestaurantsQuerySchema.parse({ limit: '500' })).toThrow(ZodError); // cap is 50
  });

  it('rejects unknown extra fields (.strict())', () => {
    expect(() => ListRestaurantsQuerySchema.parse({ page: 1, evil: 'field' })).toThrow(ZodError);
  });
});
