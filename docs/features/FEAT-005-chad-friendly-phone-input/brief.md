---
feature: FEAT-005
specs: [SPEC-005-01@1, SPEC-005-02@1]
---

# FEAT-005 — Brief d'exécution

## Fichiers concernés et abstractions à réutiliser

| Fichier                                               | Changement prévu                                | Couche    |
| ----------------------------------------------------- | ----------------------------------------------- | --------- |
| `packages/core/src/phone/normalize-phone.ts`          | **nouveau** : `normalizePhone`                  | domain    |
| `packages/core/src/index.ts`                          | export                                          | domain    |
| `packages/config/src/constants.ts`                    | `LAUNCH_MARKET.nationalNumberLength: 8`         | config    |
| `packages/validation/src/common.schema.ts`            | **nouveau** : `makePhoneInputSchema(market)`    | contract  |
| `apps/api/src/modules/auth/dto/otp-request.schema.ts` | `phone` = `makePhoneInputSchema(LAUNCH_MARKET)` | transport |

## Stratégie de test dérivée des specs

| Scénario              | Niveau    | Fichier de test                                            | Oracle                               |
| --------------------- | --------- | ---------------------------------------------------------- | ------------------------------------ |
| SPEC-005-01-SC01…SC05 | domaine   | `packages/core/src/phone/normalize-phone.spec.ts`          | valeurs exactes de la spec           |
| SPEC-005-02-SC01…SC04 | transport | `apps/api/src/modules/auth/dto/otp-request.schema.spec.ts` | E.164 de la spec, refus, `.strict()` |

## Commandes de vérification

```bash
pnpm --filter @djafat/core test:unit
pnpm --filter @djafat/api exec vitest run src/modules/auth
pnpm verify:fast
```
