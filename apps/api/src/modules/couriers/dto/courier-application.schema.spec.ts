import { describe, expect, it } from 'vitest';
import { UpdateCourierApplicationSchema } from './courier-application.schema';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-02, SPEC-024-03).

function firstIssue(input: unknown): { path: string; message: string } | null {
  const result = UpdateCourierApplicationSchema.safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return { path: issue.path.join('.'), message: issue.message };
}

describe('SPEC-024-02 — the courier’s numbers', () => {
  it('SPEC-024-02-SC03 — the emergency contact may be foreign or a fixed line', () => {
    for (const [phone, kept] of [
      ['+33 6 12 34 56 78', '+33612345678'],
      ['22 51 23 45', '+23522512345'],
    ] as const) {
      expect(
        UpdateCourierApplicationSchema.parse({ emergencyContact: { name: 'Awa Hassan', phone } }),
      ).toEqual({ emergencyContact: { name: 'Awa Hassan', phone: kept } });
    }
  });

  it('SPEC-024-02-SC04 — Mobile Money: a foreign number, then a fixed line refused; a Chad mobile kept', () => {
    const wallet = (number: string) => ({ mobileMoney: { provider: 'airtel', number } });
    expect(firstIssue(wallet('+33 6 12 34 56 78'))).toEqual({
      path: 'mobileMoney.number',
      message:
        'Le numéro Mobile Money est un numéro du Tchad : il commence par +235 (ex. 66 12 34 56).',
    });
    expect(firstIssue(wallet('22 51 23 45'))).toEqual({
      path: 'mobileMoney.number',
      message: 'Ce numéro est un fixe : indiquez un numéro de portable (ex. 66 12 34 56).',
    });
    expect(UpdateCourierApplicationSchema.parse(wallet('66 12 34 56'))).toEqual({
      mobileMoney: { provider: 'airtel', number: '+23566123456' },
    });
  });
});

describe('SPEC-024-03 — the emergency contact’s name', () => {
  it('SPEC-024-03-SC03 — « 0000 » is refused with the letters message; missing keeps the dossier’s words', () => {
    expect(firstIssue({ emergencyContact: { name: '0000', phone: '66 12 34 56' } })).toEqual({
      path: 'emergencyContact.name',
      message: 'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
    });
    expect(firstIssue({ emergencyContact: { name: 'A', phone: '66 12 34 56' } })).toEqual({
      path: 'emergencyContact.name',
      message: 'Écrivez le nom de la personne à prévenir.',
    });
  });
});
