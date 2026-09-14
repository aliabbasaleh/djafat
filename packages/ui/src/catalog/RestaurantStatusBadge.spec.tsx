import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RestaurantAvailabilityStatus } from '@djafat/types';
import { RestaurantStatusBadge } from './RestaurantStatusBadge.js';

describe('RestaurantStatusBadge (docs/21 §5 — restaurant states, mirrors docs/20 §22-§23)', () => {
  const cases: Array<[RestaurantAvailabilityStatus, string]> = [
    ['OPEN', 'Ouvert'],
    ['CLOSED', 'Fermé'],
    ['PAUSED', 'Fermé temporairement'],
    ['UNAVAILABLE', 'Indisponible'],
  ];

  it.each(cases)('renders the French label for %s', (status, label) => {
    render(<RestaurantStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('never invents its own availability — it only labels what it is given', () => {
    // No timers, no clock, no hours/closures input at all: a pure prop -> label mapping.
    render(<RestaurantStatusBadge status="PAUSED" />);
    expect(screen.queryByText('Ouvert')).not.toBeInTheDocument();
  });
});
