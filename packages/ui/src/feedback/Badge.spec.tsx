import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, type BadgeTone } from './Badge.js';

describe('Badge (docs/21 §4 — no colour-only signalling)', () => {
  it.each(['success', 'warning', 'danger', 'info', 'neutral'] as BadgeTone[])(
    'renders the "%s" tone with its text always present (never colour alone)',
    (tone) => {
      render(<Badge tone={tone}>Ouvert</Badge>);
      const badge = screen.getByText('Ouvert');
      expect(badge.className).toMatch(new RegExp(`badge-${tone}`));
    },
  );

  it('defaults to the neutral tone', () => {
    render(<Badge>Info</Badge>);
    expect(screen.getByText('Info').className).toMatch(/badge-neutral/);
  });

  it('an optional leading dot is purely decorative (aria-hidden), never the only cue', () => {
    render(<Badge dot>Ouvert</Badge>);
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    expect(screen.getByText('Ouvert')).toBeInTheDocument();
  });
});
