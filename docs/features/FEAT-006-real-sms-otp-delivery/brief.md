---
feature: FEAT-006
specs: [SPEC-006-01@1, SPEC-006-02@1]
---

# FEAT-006 — Brief d'exécution

## Fichiers concernés

| Fichier                                                                 | Changement                                 | Couche      |
| ----------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| `apps/api/src/modules/auth/providers/otp-sms-text.ts`                   | **nouveau** : texte du SMS (pur)           | domain      |
| `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.ts` | **nouveau** : adaptateur HTTP              | adapter     |
| `apps/api/src/modules/auth/auth.module.ts`                              | choix de l'adaptateur selon `SMS_PROVIDER` | composition |
| `packages/config/src/env.ts`                                            | variables SMS + règles de cohérence        | config      |
| `.env.example`                                                          | documentation                              | —           |

## Stratégie de test

| Scénarios             | Niveau                       | Fichier                                                                      |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| SPEC-006-01-SC01…SC06 | adaptateur + HTTP local réel | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| SPEC-006-02-SC01…SC04 | configuration                | `packages/config/src/env.spec.ts`                                            |
| SPEC-006-02-SC05      | revue + démonstration        | `review.md`                                                                  |

## Commandes

```bash
pnpm --filter @djafat/config test:unit
pnpm --filter @djafat/api exec vitest run src/modules/auth
pnpm verify:fast
```
