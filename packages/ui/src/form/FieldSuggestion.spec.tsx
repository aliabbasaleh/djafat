import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSuggestion } from './FieldSuggestion.js';

// FEAT-024 — SPEC-024-04 « UI et accessibilité ».
describe('FieldSuggestion', () => {
  it('shows the suggestion in a live region, with its action button', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <FieldSuggestion
        text="Vouliez-vous dire abakar@gmail.com ?"
        actionLabel="Oui, corriger"
        onAction={onAction}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Vouliez-vous dire abakar@gmail.com ?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Oui, corriger' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps the live region but shows nothing without a suggestion', () => {
    const { container } = render(
      <FieldSuggestion text={null} actionLabel="Oui, corriger" onAction={() => undefined} />,
    );
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });
});
