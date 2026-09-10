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
});
