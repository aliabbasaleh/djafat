import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RestaurantCard } from './RestaurantCard.js';

describe('RestaurantCard (docs/21 §5)', () => {
  it('renders name, rating, ETA and status — all from props, nothing computed', () => {
    render(
      <RestaurantCard
        href="/restaurants/chez-fatime"
        name="Chez Fatimé"
        status="OPEN"
        ratingAvg={4.6}
        ratingCount={128}
        etaMinutes={25}
        description="Cuisine tchadienne familiale."
      />,
    );
    expect(screen.getByRole('link', { name: /Chez Fatimé/ })).toHaveAttribute(
      'href',
      '/restaurants/chez-fatime',
    );
    expect(screen.getByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('(128)')).toBeInTheDocument();
    expect(screen.getByText('25 min')).toBeInTheDocument();
    expect(screen.getByText('Ouvert')).toBeInTheDocument();
  });

  it('falls back to a coloured initial block (never a broken-image icon) when there is no image', () => {
    render(<RestaurantCard href="/x" name="Le Sahel Grill" status="CLOSED" imageColor="#0E7C66" />);
    const fallback = screen.getByText('Le Sahel Grill', { selector: '[aria-hidden="true"]' });
    expect(fallback).toHaveStyle({ background: '#0E7C66' });
  });

  it('a paused restaurant shows PAUSED wording, not "Ouvert"', () => {
    render(<RestaurantCard href="/x" name="Snack Rapide" status="PAUSED" />);
    expect(screen.getByText('Fermé temporairement')).toBeInTheDocument();
  });
});
