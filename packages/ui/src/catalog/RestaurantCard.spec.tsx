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

  it('keeps the coloured block underneath even WITH an image — a slow or broken photo never leaves an empty card', () => {
    render(
      <RestaurantCard
        href="/x"
        name="Pizza N'Djam"
        status="OPEN"
        imageColor="#C43D0C"
        imageUrl="https://example.test/cover.png"
      />,
    );
    expect(screen.getByText("Pizza N'Djam", { selector: '[aria-hidden="true"]' })).toHaveStyle({
      background: '#C43D0C',
    });
  });

  it('marks every non-orderable status as recessed, and never an open one', () => {
    const classOf = (status: 'OPEN' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE') => {
      const { unmount } = render(<RestaurantCard href="/x" name="X" status={status} />);
      const cls = screen.getByRole('link').className;
      unmount();
      return cls;
    };
    expect(classOf('OPEN')).not.toMatch(/cardClosed/);
    expect(classOf('CLOSED')).toMatch(/cardClosed/);
    expect(classOf('PAUSED')).toMatch(/cardClosed/);
    expect(classOf('UNAVAILABLE')).toMatch(/cardClosed/);
  });

  it('a paused restaurant shows PAUSED wording, not "Ouvert"', () => {
    render(<RestaurantCard href="/x" name="Snack Rapide" status="PAUSED" />);
    expect(screen.getByText('Fermé temporairement')).toBeInTheDocument();
  });
});
