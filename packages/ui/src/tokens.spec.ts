import { describe, expect, it } from 'vitest';
import { px, spaceVar, SPACE_KEYS } from './tokens.js';

describe('spaceVar / px (docs/21 §2 — the Bloc 2 unitless-token bug, fixed centrally)', () => {
  it.each(SPACE_KEYS)(
    'spaceVar("%s") wraps the token in calc(... * 1px), never a bare var()',
    (key) => {
      const result = spaceVar(key);
      expect(result).toBe(`calc(var(--djafat-space-${key}) * 1px)`);
      // The exact shape of the Bloc 2 bug (docs/20 §19.1): a bare `var(...)` used
      // as a CSS length is invalid at computed-value time. Guard against ever
      // regressing to that shape.
      expect(result).not.toMatch(/^var\(/);
    },
  );

  it('px() applies the same calc(...) wrapping to an arbitrary custom property', () => {
    expect(px('--djafat-radius-md')).toBe('calc(var(--djafat-radius-md) * 1px)');
  });
});
