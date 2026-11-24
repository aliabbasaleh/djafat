import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input.js';

describe('Input (docs/21 §4 — `label` is mandatory, never a placeholder substitute)', () => {
  it('associates the visible label with the control (findable by label text)', () => {
    render(<Input label="Nom du restaurant" />);
    expect(screen.getByLabelText('Nom du restaurant')).toBeInTheDocument();
  });

  it('typing updates the value', async () => {
    render(<Input label="Recherche" />);
    const input = screen.getByLabelText('Recherche');
    await userEvent.type(input, 'Poulet');
    expect(input).toHaveValue('Poulet');
  });

  it('help text is announced via aria-describedby', () => {
    render(<Input label="Téléphone" helpText="Format +235XXXXXXXX" />);
    const input = screen.getByLabelText('Téléphone');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Format +235XXXXXXXX');
  });

  it('an error is announced as an alert and marks the field aria-invalid', () => {
    render(<Input label="Email" error="Adresse invalide" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Adresse invalide');
  });

  it('an error takes over the description slot (help text is hidden once there is an error)', () => {
    render(
      <Input label="Email" helpText="Utilisée pour la confirmation" error="Adresse invalide" />,
    );
    expect(screen.queryByText('Utilisée pour la confirmation')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Adresse invalide');
  });

  it('hideLabel keeps the label in the accessibility tree while hiding it visually', () => {
    render(<Input label="Rechercher un restaurant ou un plat" hideLabel />);
    expect(screen.getByLabelText('Rechercher un restaurant ou un plat')).toBeInTheDocument();
  });

  // FEAT-024 — SPEC-024-02 « UI et accessibilité »: « +235 » in front, part of the field's name.
  it('a leading text sits before the box and is part of its accessible name', () => {
    render(<Input label="Numéro de téléphone" leadingText="+235" />);
    expect(
      screen.getByRole('textbox', { name: /^Numéro de téléphone ?, indicatif \+235$/ }),
    ).toBeInTheDocument();
  });

  it('a description given by the page is kept, the name keeps the leading text', () => {
    render(
      <>
        <p id="page-hint">Code envoyé par WhatsApp.</p>
        <Input label="Numéro" leadingText="+235" aria-describedby="page-hint" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: /indicatif \+235/ });
    expect(input).toHaveAttribute('aria-describedby', 'page-hint');
  });
});
