import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryChip } from './CategoryChip.js';

describe('CategoryChip', () => {
  it('renders a real link (keyboard/screen-reader reachable), not a styled span', () => {
    render(<CategoryChip label="Plats" href="/restaurants?search=Plats" />);
    const link = screen.getByRole('link', { name: 'Plats' });
    expect(link).toHaveAttribute('href', '/restaurants?search=Plats');
  });

  it('marks the selected chip with aria-current, not colour alone', () => {
    render(<CategoryChip label="Plats" href="/x" selected />);
    expect(screen.getByRole('link', { name: 'Plats' })).toHaveAttribute('aria-current', 'true');
  });

  it('an unselected chip carries no aria-current', () => {
    render(<CategoryChip label="Plats" href="/x" />);
    expect(screen.getByRole('link', { name: 'Plats' })).not.toHaveAttribute('aria-current');
  });
});
