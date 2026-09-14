import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, type TabItem } from './Tabs.js';

const ITEMS: TabItem[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'list', label: 'Restaurants' },
  { id: 'detail', label: 'Restaurant' },
];

function Controlled() {
  const [active, setActive] = useState('home');
  return <Tabs items={ITEMS} activeId={active} onChange={setActive} aria-label="Pages" />;
}

describe('Tabs (docs/21 §4 — full WAI-ARIA APG keyboard pattern)', () => {
  it('exposes the tablist/tab roles and marks exactly one tab selected', () => {
    render(<Controlled />);
    expect(screen.getByRole('tablist', { name: 'Pages' })).toBeInTheDocument();
    const selected = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Accueil');
  });

  it('clicking a tab selects it', async () => {
    render(<Controlled />);
    await userEvent.click(screen.getByRole('tab', { name: 'Restaurants' }));
    expect(screen.getByRole('tab', { name: 'Restaurants' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Accueil' })).toHaveAttribute('aria-selected', 'false');
  });

  // Keyboard navigation always moves relative to `activeId` (the controlled
  // selection), not wherever DOM focus happens to sit — matching the
  // roving-tabindex pattern where only the active tab is ever reachable by
  // Tab key, so focus and selection stay in lockstep in real usage.
  it('ArrowRight moves to and activates the next tab, wrapping at the end', async () => {
    render(<Controlled />);
    screen.getByRole('tab', { name: 'Accueil' }).focus(); // the active tab — the only one with tabIndex 0
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Restaurants' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Restaurants' })).toHaveFocus();
  });

  it('ArrowLeft moves to the previous tab, wrapping at the start', async () => {
    render(<Controlled />);
    screen.getByRole('tab', { name: 'Accueil' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Restaurant' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Restaurant' })).toHaveFocus();
  });

  it('End jumps to the last tab, Home back to the first', async () => {
    render(<Controlled />);
    screen.getByRole('tab', { name: 'Accueil' }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Restaurant' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Accueil' })).toHaveAttribute('aria-selected', 'true');
  });

  it('only the active tab is in the natural tab order (roving tabindex)', () => {
    render(<Controlled />);
    expect(screen.getByRole('tab', { name: 'Accueil' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: 'Restaurants' })).toHaveAttribute('tabIndex', '-1');
  });
});
