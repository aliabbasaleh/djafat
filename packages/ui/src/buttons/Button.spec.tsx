import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button.js';

describe('Button (docs/21 §4 — states)', () => {
  it('renders a native <button type="button"> by default', () => {
    render(<Button>Valider</Button>);
    const btn = screen.getByRole('button', { name: 'Valider' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('renders an <a> instead of a <button> when `href` is given — a link is never a fake button', () => {
    render(<Button href="/restaurants">Voir les restaurants</Button>);
    const link = screen.getByRole('link', { name: 'Voir les restaurants' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/restaurants');
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Envoyer</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled: never fires onClick, exposes the native disabled state', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Envoyer
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Envoyer' });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading: disables the button too (never clickable mid-request) and shows a labelled spinner', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Envoyer
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /Envoyer/ });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    // The spinner carries an accessible label — loading is not a purely visual cue.
    expect(screen.getByRole('status', { name: 'Chargement…' })).toBeInTheDocument();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'applies the "%s" variant class',
    (variant) => {
      render(<Button variant={variant}>X</Button>);
      expect(screen.getByRole('button').className).toMatch(new RegExp(`variant-${variant}`));
    },
  );
});
