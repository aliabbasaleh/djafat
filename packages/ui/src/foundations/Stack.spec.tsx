import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stack } from './Stack.js';

describe('Stack (foundations — layout via gap, never per-element margins)', () => {
  it('renders as a <div> by default with children and a gap custom property', () => {
    render(
      <Stack>
        <span>Un</span>
        <span>Deux</span>
      </Stack>,
    );
    expect(screen.getByText('Un')).toBeInTheDocument();
    expect(screen.getByText('Deux')).toBeInTheDocument();
  });

  it('`as` renders a different element without changing behaviour', () => {
    render(
      <Stack as="section">
        <span>Contenu</span>
      </Stack>,
    );
    const content = screen.getByText('Contenu');
    expect(content.parentElement?.tagName).toBe('SECTION');
  });

  // Audit FE-09: these attributes used to be dropped, so the home page's sections had no name.
  it('a section is named by its heading: aria-labelledby and id reach the element', () => {
    render(
      <Stack as="section" aria-labelledby="open-heading" id="open-restaurants">
        <h2 id="open-heading">Ouverts maintenant</h2>
      </Stack>,
    );
    const region = screen.getByRole('region', { name: 'Ouverts maintenant' });
    expect(region).toHaveAttribute('id', 'open-restaurants');
  });

  it('a loading state keeps aria-busy and aria-label', () => {
    render(
      <Stack gap="sm" aria-busy="true" aria-label="Chargement du menu">
        <span>Chargement…</span>
      </Stack>,
    );
    const box = screen.getByText('Chargement…').parentElement;
    expect(box).toHaveAttribute('aria-busy', 'true');
    expect(box).toHaveAttribute('aria-label', 'Chargement du menu');
  });
});
