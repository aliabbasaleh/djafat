import { describe, expect, it } from 'vitest';
import { FieldValidationError } from './errors.js';

// FEAT-020 — review #8: a rule on one field, answered by the API like a schema failure.
describe('FieldValidationError', () => {
  it('carries its issues per field, a stable name and message', () => {
    const issues = [{ path: 'newPassword', message: 'Trop proche de votre nom.' }];
    const err = new FieldValidationError(issues);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FieldValidationError');
    expect(err.message).toBe('Request validation failed');
    expect(err.issues).toEqual(issues);
  });
});
