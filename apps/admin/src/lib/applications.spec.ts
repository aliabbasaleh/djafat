import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@djafat/sdk';
import {
  birthAndAge,
  changeDecisionMessage,
  decisionErrorMessage,
  decisionMessage,
  paperAlt,
  photoAlt,
  sentOn,
} from './applications';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-07, FEAT-022-VIS06).

describe('SPEC-022-07 — « Demandes à vérifier »', () => {
  it('SPEC-022-07-SC07 — a row says « envoyée le 22/11 à 10:14 » in N’Djamena’s time (UTC+1)', () => {
    expect(sentOn('2026-11-22T09:14:00.000Z')).toBe('envoyée le 22/11 à 10:14');
  });

  it('SPEC-022-07 R2 — the courier’s birth date with the age', () => {
    expect(birthAndAge({ birthDate: '2001-04-12', age: 25 })).toBe('12/04/2001 (25 ans)');
    expect(birthAndAge({ birthDate: null, age: null })).toBe('non renseignée');
  });

  it('SPEC-022-07 « UI et accessibilité » — each photo has its text: « Pièce d’identité de … »', () => {
    expect(photoAlt('id_card', 'Abakar Mahamat')).toBe('Pièce d’identité de Abakar Mahamat');
  });

  it('SPEC-022-07 R5 — the admin learns whether the e-mail left; the decision stands either way', () => {
    expect(decisionMessage({ id: 'u', status: 'rejected', email: 'sent' })).toBe(
      'Dossier refusé. Le livreur a reçu un e-mail.',
    );
    expect(decisionMessage({ id: 'u', status: 'approved', email: 'failed' })).toBe(
      'Dossier validé. L’e-mail n’a pas pu partir : prévenez le livreur autrement.',
    );
  });

  it('SPEC-022-07-SC06 — the second admin is told someone else already decided', () => {
    expect(
      decisionErrorMessage(
        new ApiClientError({ status: 409, code: 'ALREADY_DECIDED', message: 'x' }),
      ),
    ).toBe('Un autre administrateur a déjà décidé ce dossier : rechargez la page.');
  });
});

// FEAT-022 part 3 — restaurants and changes after the approval (SPEC-022-07 R2, R5, R6).
describe('SPEC-022-07 — restaurants and changes', () => {
  it('SPEC-022-07 R5 — a restaurant’s decision names its owner', () => {
    expect(decisionMessage({ id: 'r', status: 'approved', email: 'sent' }, 'restaurant')).toBe(
      'Dossier validé. Le responsable du restaurant a reçu un e-mail.',
    );
    expect(
      decisionMessage({ id: 'r', status: 'rejected', email: 'no_address' }, 'restaurant'),
    ).toBe(
      'Dossier refusé. Ce compte n’a pas d’adresse e-mail : prévenez le responsable du restaurant autrement.',
    );
  });

  it('SPEC-022-07 R6 — a change accepted or refused, and its e-mail', () => {
    expect(changeDecisionMessage({ id: 'u', status: 'approved', email: 'sent' }, 'courier')).toBe(
      'Changement accepté. Le livreur a reçu un e-mail.',
    );
    expect(
      changeDecisionMessage({ id: 'r', status: 'rejected', email: 'failed' }, 'restaurant'),
    ).toBe(
      'Changement refusé. L’e-mail n’a pas pu partir : prévenez le responsable du restaurant autrement.',
    );
    expect(
      decisionErrorMessage(
        new ApiClientError({ status: 404, code: 'CHANGE_NOT_FOUND', message: 'x' }),
      ),
    ).toBe('Ce changement a été remplacé par un plus récent : rechargez la page.');
  });

  it('SPEC-022-07 « UI et accessibilité » — a paper’s text: « RCCM ou NIF de Chez Fatimé »', () => {
    expect(paperAlt('registry', 'Chez Fatimé')).toBe('RCCM ou NIF de Chez Fatimé');
  });
});
