import { describe, expect, it } from 'vitest';
import { UpdateMeSchema } from './update-me.schema';

// FEAT-024 — docs/features/FEAT-024-saisies-verifiees (SPEC-024-03).

describe('SPEC-024-03 — « Mon profil » name', () => {
  it('SPEC-024-03-SC03 — « 12345 » is refused with the letters message; a name is trimmed', () => {
    const refused = UpdateMeSchema.safeParse({ fullName: '12345' });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues[0]?.message).toBe(
        'Le nom ne contient que des lettres (ex. Abakar Mahamat).',
      );
    }
    expect(UpdateMeSchema.parse({ fullName: '  Awa   Hassan ' })).toEqual({
      fullName: 'Awa Hassan',
    });
  });
});
