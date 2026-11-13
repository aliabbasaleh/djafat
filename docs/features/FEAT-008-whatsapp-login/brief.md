---
feature: FEAT-008
specs: [SPEC-008-01@2, SPEC-008-02@2, SPEC-008-03@1, SPEC-008-04@1]
---

# FEAT-008 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                          | Changement                                                       | Couche      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| `apps/api/prisma/migrations/0031_whatsapp_otp/migration.sql`                     | **nouveau** : canal `whatsapp` permis                            | adapter     |
| `apps/api/src/modules/auth/otp.service.ts`                                       | 3ᵉ canal ; transport, audit et limite choisis par canal          | application |
| `apps/api/src/modules/auth/otp-delivery.token.ts`                                | jeton `OTP_WHATSAPP_DELIVERY_PORT`                               | application |
| `apps/api/src/modules/auth/auth-methods.ts`                                      | **nouveau** : registre des méthodes (pur, à partir de la config) | domain      |
| `apps/api/src/modules/auth/whatsapp-inbound.service.ts`                          | **nouveau** : signature, filtrage, dédoublonnage, plafond        | application |
| `apps/api/src/modules/auth/providers/whatsapp-otp-text.ts`                       | **nouveau** : texte du message (pur)                             | domain      |
| `apps/api/src/modules/auth/providers/cloud-whatsapp-otp-delivery.provider.ts`    | **nouveau** : adaptateur WhatsApp Cloud                          | adapter     |
| `apps/api/src/modules/auth/providers/mock-whatsapp-otp-delivery.provider.ts`     | **nouveau** : faux (Redis hors production)                       | adapter     |
| `apps/api/src/modules/auth/providers/disabled-sms-otp-delivery.provider.ts`      | **nouveau** : SMS coupé → 503 `SMS_UNAVAILABLE`                  | adapter     |
| `apps/api/src/modules/auth/auth.service.ts`                                      | `verifyWhatsappAndLogin` (même chemin que le SMS)                | application |
| `apps/api/src/modules/auth/auth.controller.ts`, `whatsapp-webhook.controller.ts` | routes `methods`, `whatsapp/verify`, `whatsapp/webhook`          | transport   |
| `apps/api/src/modules/auth/auth.module.ts`                                       | choix des transports                                             | config      |
| `packages/config/src/env.ts`, `packages/types/src/errors.ts`, `.env.example`     | variables, cohérence production, codes d'erreur                  | config      |

Réutilisés sans changement : `RateLimiterService`, `RedisService`, `rawBody`
(`main.ts`), `makePhoneInputSchema`, `UsersService.findOrCreateByPhone`,
`markPhoneVerified`, `openSession`.

## Stratégie de test

| Scénarios             | Niveau                  | Fichier                                                                      |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| SPEC-008-01-SC01…SC03 | unitaire                | `apps/api/src/modules/auth/auth-methods.spec.ts`                             |
| SPEC-008-01-SC04      | configuration           | `packages/config/src/env.spec.ts`                                            |
| SPEC-008-02-SC01…SC06 | application (faux)      | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| SPEC-008-03-SC01…SC03 | application (faux)      | `apps/api/src/modules/auth/auth-whatsapp.spec.ts`                            |
| SPEC-008-04-SC01…SC04 | adaptateur + HTTP local | `apps/api/src/modules/auth/providers/whatsapp-otp-delivery.provider.spec.ts` |
| SPEC-008-03-SC04      | exécution réelle        | `e2e-demo.md`                                                                |

## Vérifications

`pnpm --filter @djafat/api test:unit` · `pnpm --filter @djafat/config test` ·
`pnpm verify:fast` · `pnpm verify`.

## Critères de fin

Tous les scénarios couverts par un test vert (ou la preuve manuelle de SC04),
`verify` sans nouvel échec, `review.md` sans constat bloquant.
