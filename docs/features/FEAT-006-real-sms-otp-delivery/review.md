# FEAT-006 — Revue qualité

Revue faite par l'agent principal, en relisant SPEC-006-01@1 et SPEC-006-02@1
avant le diff. Le sous-agent `spec-reviewer` n'a pas été invoqué.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges : 4 sur la configuration, et
  l'adaptateur introuvable. Puis verts : `@djafat/config` 12/12 ; auth et common de l'API 166/166.
- L'adaptateur est testé contre un **vrai serveur HTTP local**, sans simulation de `fetch`.
- **Exécution réelle de bout en bout** : `e2e-demo.md`. Elle a trouvé un bug que les tests
  unitaires ne voyaient pas (constat #1).
- `verify --full` : voir `verification.md`.

## 2. Constats de revue

| #   | Sévérité | Emplacement                    | Constat                                                                                                                                                                                                                                                     | Correction attendue                                                                                        |
| --- | -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | corrigé  | `packages/types/src/errors.ts` | Trouvé en exécution réelle : le client recevait `INTERNAL` au lieu de `OTP_DELIVERY_FAILED`, parce que le code n'était pas dans le vocabulaire fermé `API_ERROR_CODES`. Le test initial vérifiait l'exception brute, pas la réponse après le filtre.        | Fait : code ajouté, et test de non-régression à travers `AllExceptionsFilter` (constaté rouge, puis vert). |
| 2   | note     | `auth.module.ts`               | **Preuve de revue de SPEC-006-02-SC05** : `OTP_DELIVERY_PORT` est choisi par une table `{ mock, http }` indexée par `SMS_PROVIDER` (typé `'mock' \| 'http'`, donc exhaustif à la compilation). La démonstration de bout en bout confirme le câblage `http`. | Aucune.                                                                                                    |
| 3   | mineur   | `otp.service.ts:88-89`         | La ligne `otp_codes` est créée **avant** l'envoi. Si le SMS échoue, elle compte quand même dans la limite de 3 demandes par 10 minutes et par numéro (comportement existant).                                                                               | À revoir si les échecs de passerelle sont fréquents : ne pas compter une demande non délivrée.             |
| 4   | note     | contrat `{ to, from, body }`   | C'est un contrat générique. Un agrégateur réel a son propre format (noms de champs, authentification) : ce sera un petit adaptateur en plus, derrière le même port.                                                                                         | À faire au choix du fournisseur (FEAT-006-Q01).                                                            |
| 5   | note     | `.env.example`                 | Les nouvelles variables sont documentées, avec un exemple pour pointer vers `infra/mock-sms` en local.                                                                                                                                                      | Aucune.                                                                                                    |

## 3. Verdict

**Prêt pour PR**, sans constat bloquant.

## Matrice

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                       |
| ---------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| FEAT-006-AC01                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC01 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC02                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC02 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC03 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC04 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC05 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC06 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC01 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC02 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC03 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC05                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC04 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04, FEAT-006-AC05 | SPEC-006-02@1 (implemented) | SPEC-006-02-SC05 | _review_                                                                     |
