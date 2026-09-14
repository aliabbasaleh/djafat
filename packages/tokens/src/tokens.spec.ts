import { describe, expect, it } from 'vitest';
import { toCssRootBlock, toCssVariables, tokens } from './index.js';

describe('tokens', () => {
  it('exposes the brand palette and breakpoints', () => {
    expect(tokens.color.brand.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tokens.breakpoint.md).toBe(600);
    expect(tokens.touchTarget.min).toBe(44);
  });

  it('flattens into kebab-case CSS custom properties', () => {
    const vars = toCssVariables();
    expect(vars['--djafat-color-brand-primary']).toBe(tokens.color.brand.primary);
    expect(vars['--djafat-color-brand-primary-strong']).toBe(tokens.color.brand.primaryStrong);
    expect(vars['--djafat-space-4']).toBe('16');
  });

  it('renders a :root block', () => {
    const css = toCssRootBlock();
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain('--djafat-color-brand-primary:');
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('Bloc 2 keys are unchanged (additive-only extension — docs/21 §2)', () => {
    expect(tokens.color.brand.primary).toBe('#E8531B');
    expect(tokens.color.brand.primaryStrong).toBe('#C43D0C');
    expect(tokens.color.bg.surfaceAlt).toBe('#F3EDE4');
    expect(tokens.space['4']).toBe(16);
    expect(tokens.radius.md).toBe(12);
    expect(tokens.type.size.body).toBe(15);
  });

  it('exposes the Bloc 3 additions: interaction ramp, shadow, motion, named space/type scales', () => {
    expect(tokens.color.brand.primaryHover).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tokens.color.state.dangerBg).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tokens.shadow.card).toContain('rgba');
    expect(tokens.motion.duration.base).toBe(200);
    expect(tokens.motion.easing.standard).toContain('cubic-bezier');
    // Named aliases resolve to the SAME value as their numeric predecessor.
    expect(tokens.space.md).toBe(tokens.space['4']);
    expect(tokens.space.lg).toBe(tokens.space['6']);
    expect(tokens.type.size.h3).toBe(16);
    expect(tokens.type.weight.bold).toBe(700);
    expect(tokens.type.lineHeight.tight).toBeLessThan(tokens.type.lineHeight.relaxed);
  });
});
