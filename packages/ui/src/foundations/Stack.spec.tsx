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
});
