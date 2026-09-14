import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal.js';

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirmer">
        <p>Contenu de la modale</p>
        <button type="button">Action</button>
      </Modal>
    </>
  );
}

describe('Modal (docs/21 §4 — overlay accessibility: dialog role, focus trap, Escape, restore focus)', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opening moves focus inside the dialog (the first focusable element) and exposes an accessible name from the title', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirmer' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // `useOverlay` focuses the first focusable descendant, not the inert
    // container — here that is the visible "Fermer" close button.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus());
  });

  it('Escape closes the modal and restores focus to the trigger', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('the visible close button also closes the modal', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('onClose is never called while staying closed (no spurious close events)', () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose} title="X">
        body
      </Modal>,
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
