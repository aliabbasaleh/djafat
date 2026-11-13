---
feature: FEAT-007
specs: [SPEC-007-01@1, SPEC-007-02@1, SPEC-007-03@1]
---

# FEAT-007 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                   | Changement                                          | Couche      |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ----------- |
| `apps/api/prisma/migrations/0030_email_otp/migration.sql`                 | **nouveau** : renommages, `channel`, `verify_email` | adapter     |
| `apps/api/prisma/schema.prisma`                                           | `OtpCode.target/channel`, `AuthTargetLock`          | adapter     |
| `apps/api/src/modules/auth/otp.service.ts`                                | généralisé par cible `{ channel, target }`          | application |
| `apps/api/src/modules/auth/providers/email-otp-text.ts`                   | **nouveau** : sujet et texte (pur)                  | domain      |
| `apps/api/src/modules/auth/providers/smtp-email-otp-delivery.provider.ts` | **nouveau** : adaptateur SMTP                       | adapter     |
| `apps/api/src/modules/auth/providers/mock-email-otp-delivery.provider.ts` | **nouveau** : faux (Redis hors production)          | adapter     |
| `apps/api/src/modules/auth/auth.service.ts`                               | flux e-mail ; émission de session factorisée        | application |
| `apps/api/src/modules/auth/auth.controller.ts`, `me.controller.ts`        | 4 routes                                            | transport   |
| `apps/api/src/modules/auth/dto/email.schema.ts`                           | **nouveau** : schémas Zod                           | transport   |
| `apps/api/src/modules/users/users.service.ts`                             | `findByVerifiedEmail`, `setVerifiedEmail`           | application |
| `packages/config/src/env.ts`, `packages/types/src/errors.ts`              | variables, codes d'erreur                           | config      |

## Stratégie de test

| Scénarios                                    | Niveau                       | Fichier                                                                   |
| -------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| SPEC-007-01-SC01…SC03, SC05                  | adaptateur + SMTP réel local | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| SPEC-007-01-SC04                             | configuration                | `packages/config/src/env.spec.ts`                                         |
| SPEC-007-02-SC01…SC04, SPEC-007-03-SC01…SC05 | application (faux)           | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| SPEC-007-02-SC05, SPEC-007-03-SC06           | exécution réelle             | `e2e-demo.md`                                                             |
