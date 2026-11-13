# feat(auth): accept phone numbers as they are typed in Chad

## Objectif

FEAT-005 : se connecter en tapant son numéro comme on l'écrit au Tchad.

## Avant / après

| Saisie                     | Avant                   | Après                                          |
| -------------------------- | ----------------------- | ---------------------------------------------- |
| `66 12 34 56`              | 422 VALIDATION_ERROR    | `+23566123456`                                 |
| `00235 66 12 34 56`        | 422                     | `+23566123456`                                 |
| `٦٦١٢٣٤٥٦` (clavier arabe) | 422                     | `+23566123456`                                 |
| `+33 6 12 34 56 78`        | 422 (espaces)           | `+33612345678`                                 |
| `6612345`                  | 422 (message générique) | 422, message « 8 chiffres (ex. 66 12 34 56)… » |

## Specs et critères couverts

| Critère       | Spec (version)              | Scénario         | Preuve                                                     |
| ------------- | --------------------------- | ---------------- | ---------------------------------------------------------- |
| FEAT-005-AC01 | SPEC-005-01@1 (implemented) | SPEC-005-01-SC01 | `packages/core/src/phone/normalize-phone.spec.ts`          |
| FEAT-005-AC02 | SPEC-005-01@1 (implemented) | SPEC-005-01-SC02 | `packages/core/src/phone/normalize-phone.spec.ts`          |
| FEAT-005-AC03 | SPEC-005-01@1 (implemented) | SPEC-005-01-SC03 | `packages/core/src/phone/normalize-phone.spec.ts`          |
| FEAT-005-AC04 | SPEC-005-01@1 (implemented) | SPEC-005-01-SC04 | `packages/core/src/phone/normalize-phone.spec.ts`          |
| FEAT-005-AC04 | SPEC-005-01@1 (implemented) | SPEC-005-01-SC05 | `packages/core/src/phone/normalize-phone.spec.ts`          |
| FEAT-005-AC01 | SPEC-005-02@1 (implemented) | SPEC-005-02-SC01 | `apps/api/src/modules/auth/dto/otp-request.schema.spec.ts` |
| FEAT-005-AC05 | SPEC-005-02@1 (implemented) | SPEC-005-02-SC02 | `apps/api/src/modules/auth/dto/otp-request.schema.spec.ts` |
| FEAT-005-AC04 | SPEC-005-02@1 (implemented) | SPEC-005-02-SC03 | `apps/api/src/modules/auth/dto/otp-request.schema.spec.ts` |
| FEAT-005-AC04 | SPEC-005-02@1 (implemented) | SPEC-005-02-SC04 | `apps/api/src/modules/auth/dto/otp-request.schema.spec.ts` |

## Vérifications exécutées

Voir `verification.md`.

## Risques et limites

- Les textes des écrans ne changent pas (en attente de maquette).
- Pas de contrôle de préfixe opérateur (FEAT-005-Q01).
