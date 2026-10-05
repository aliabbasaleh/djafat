import { describe, expect, it } from 'vitest';
import { statusLabel, statusTone } from './order-status';

describe('order-status (Bloc 10, docs/33 §order-board)', () => {
  it('labels every status the board/history pages can show', () => {
    expect(statusLabel('placed')).toBe('Nouvelle');
    expect(statusLabel('ready')).toBe('Prête');
    expect(statusLabel('delivered')).toBe('Livrée');
    expect(statusLabel('cancelled')).toBe('Annulée');
  });

  it('falls back to the raw status string for anything unmapped — never throws, never shows blank', () => {
    expect(statusLabel('some_future_status')).toBe('some_future_status');
    expect(statusTone('some_future_status')).toBe('neutral');
  });

  it('uses a distinct tone for success/danger/warning states', () => {
    expect(statusTone('ready')).toBe('success');
    expect(statusTone('rejected')).toBe('danger');
    expect(statusTone('preparing')).toBe('warning');
  });
});
