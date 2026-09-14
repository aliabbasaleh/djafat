import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox.js';

function Controlled() {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      label="Ouvert maintenant"
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );
}

describe('Checkbox', () => {
  it('is reachable by its label and toggles on click', async () => {
    render(<Controlled />);
    const box = screen.getByLabelText('Ouvert maintenant');
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(box).toBeChecked();
  });

  it('disabled: cannot be toggled by click', async () => {
    render(<Checkbox label="Ouvert maintenant" disabled />);
    const box = screen.getByLabelText('Ouvert maintenant');
    expect(box).toBeDisabled();
    await userEvent.click(box);
    expect(box).not.toBeChecked();
  });
});
