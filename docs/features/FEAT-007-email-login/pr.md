# feat(auth): add a verified email to one's account and log in with an email code

## Objectif

FEAT-007 : l'e-mail devient un identifiant **secondaire et vérifié**, et une
connexion de secours **gratuite** quand le SMS n'arrive pas. Le téléphone reste obligatoire.

## Routes

| Route                         | Accès    | Effet                                                   |
| ----------------------------- | -------- | ------------------------------------------------------- |
| `POST /v1/me/email`           | connecté | envoie un code à l'adresse                              |
| `POST /v1/me/email/verify`    | connecté | l'adresse devient vérifiée (409 si déjà prise)          |
| `POST /v1/auth/email/request` | public   | toujours 202 ; code seulement si l'adresse est vérifiée |
| `POST /v1/auth/email/verify`  | public   | ouvre une session, comme `otp/verify`                   |

## Changements notables

- **Migration 0030** : renommages `otp_codes.phone` → `target`, colonne `channel`,
  table `auth_target_locks`. Données conservées (prouvé).
- `OtpService` est générique : une seule logique de sécurité pour le SMS et l'e-mail.
- Configuration : `EMAIL_PROVIDER=mock|smtp`, `SMTP_URL`, `EMAIL_FROM`. Sans SMTP en production, les routes e-mail répondent 503 `EMAIL_UNAVAILABLE`, sans bloquer le démarrage.

## Specs et critères couverts

| Critère                                     | Spec (version)              | Scénario         | Preuve                                                                    |
| ------------------------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------- |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC01 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC02 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC03 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC04 | `packages/config/src/env.spec.ts`                                         |
| FEAT-007-AC06                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC05 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC01                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC01 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC02 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC03 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC04 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC01, FEAT-007-AC02, FEAT-007-AC06 | SPEC-007-02@1 (implemented) | SPEC-007-02-SC05 | _manual_                                                                  |
| FEAT-007-AC03                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC01 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC03                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC02 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC03 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC04 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04, FEAT-007-AC06                | SPEC-007-03@1 (implemented) | SPEC-007-03-SC05 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC03, FEAT-007-AC04                | SPEC-007-03@1 (implemented) | SPEC-007-03-SC06 | _manual_                                                                  |

## Vérifications

`verification.md` et `e2e-demo.md`.
