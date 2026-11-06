# FEAT-005 — Revue qualité

Revue faite par l'agent principal, en relisant SPEC-005-01@1 et SPEC-005-02@1
avant le diff. Le sous-agent `spec-reviewer` n'a pas été invoqué.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges :
  - domaine : module introuvable ;
  - API : 3 échecs sur 4. Le schéma strict actuel refusait `66 12 34 56` ; le test `.strict()` passait déjà, ce qui est normal.
- Après l'implémentation : domaine 5/5, auth API 96/96 (9 fichiers), `verify:fast` vert.
- `verify --full` : voir `verification.md`.

## 2. Constats de revue

| #   | Sévérité | Emplacement                                           | Constat                                                                                                                                                                                                                             | Justification          | Correction attendue                                                          |
| --- | -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| 1   | corrigé  | `packages/core/src/phone/normalize-phone.ts:23`       | La regex contenait des espaces insécables **littéraux**, invisibles en relecture. Attrapé par `no-irregular-whitespace` et remplacé par `\s`, qui couvre déjà U+00A0 et U+202F. Le test les écrit désormais en `\u00a0` explicites. | Lisibilité, linter     | Fait.                                                                        |
| 2   | mineur   | écrans de connexion des 5 apps                        | Les messages disent toujours « format +235XXXXXXXX » alors que l'API accepte maintenant 8 chiffres. Ce n'est pas faux, mais c'est plus restrictif que la réalité.                                                                   | FEAT-005-Q04 (UI)      | Changer les textes avec la maquette des écrans (hors périmètre, en attente). |
| 3   | note     | `apps/api/src/modules/auth/dto/otp-request.schema.ts` | Demande et vérification passent par le même `PhoneInput` : clé de compte, de limite de débit et de code identiques, quelle que soit l'écriture (SC02).                                                                              | SPEC-005-02 R1         | Aucune.                                                                      |
| 4   | note     | `packages/core`                                       | La fonction est pure : le marché est passé en paramètre, et `domain-purity` ainsi que `check:arch` sont verts. Rien n'est codé en dur pour le Tchad dans le domaine.                                                                | architecture-policy §4 | Aucune.                                                                      |
| 5   | note     | adresses, restaurants                                 | `PhoneSchema` (E.164 strict) reste utilisé ailleurs. On pourra étendre `makePhoneInputSchema` à ces champs plus tard.                                                                                                               | Périmètre              | Feature ultérieure si besoin.                                                |

Pas de test HTTP de bout en bout : le pipe de validation Zod est commun à toutes
les routes, et seul le schéma change.

## 3. Verdict

**Prêt pour PR**, sans constat bloquant.

## Matrice

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
