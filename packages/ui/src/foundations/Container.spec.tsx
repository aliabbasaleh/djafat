import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container } from './Container.js';

describe('Container (foundations — the outermost wrapper of every page)', () => {
  // Audit FE-09: the site's loading pages pass aria-busy and aria-label to it.
  it('passes aria-* attributes to its element: a loading page is a named, busy main', () => {
    render(
      <Container as="main" aria-busy="true" aria-label="Chargement">
        <span>Chargement…</span>
      </Container>,
    );
    const main = screen.getByRole('main', { name: 'Chargement' });
    expect(main).toHaveAttribute('aria-busy', 'true');
  });

  it('renders its children in a <div> by default', () => {
    render(
      <Container>
        <span>Contenu</span>
      </Container>,
    );
    expect(screen.getByText('Contenu').parentElement?.tagName).toBe('DIV');
  });
});
