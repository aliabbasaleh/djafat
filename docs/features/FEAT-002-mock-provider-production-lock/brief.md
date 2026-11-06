---
feature: FEAT-002
specs: [SPEC-002-01@1, SPEC-002-02@2]
---

# FEAT-002 — Brief d'exécution

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-002-01.md` (v1), `specs/SPEC-002-02.md` (v2)
- Règles : `CLAUDE.md`, `README.md` §Règles non négociables (registre data-driven), `docs/pipeline/architecture-policy.md`

## Fichiers concernés et abstractions à réutiliser

| Fichier                                                                 | Rôle actuel                    | Changement prévu                                                                                 | Couche      |
| ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| `packages/types/src/payment-provider.ts`                                | contrat `ProviderCapabilities` | ajout de `sandboxOnly?: boolean`                                                                 | contract    |
| `apps/api/src/modules/payments/payment-provider-selection.ts`           | —                              | **nouveau** : `selectRegistrableProviders`, `sandboxOnlyCodes`, `seedPaymentProviderPlan` (purs) | domain      |
| `apps/api/src/modules/payments/providers/mock/mock-payment.provider.ts` | fournisseur mock               | `sandboxOnly: true` dans ses capacités                                                           | adapter     |
| `apps/api/src/modules/payments/payments.module.ts`                      | composition du registre        | la factory injecte `AppConfigService` et filtre avec `selectRegistrableProviders`                | composition |
| `apps/api/prisma/seed.ts`                                               | seed                           | consomme `seedPaymentProviderPlan(isProduction)`                                                 | composition |
| `apps/api/src/modules/payments/payments-test-support.ts`                | harnais du module              | `buildPaymentsService` accepte un registre optionnel                                             | test        |

Réutilisés tels quels : `PaymentProviderRegistry`, `registry.has()` dans `PaymentsService`
(création, webhook, liste), `AppConfigService.isProduction`. Aucune nouvelle arête
de DAG : `AppConfigService` est dans `common/`.

## Stratégie de test dérivée des specs

| Scénario         | Niveau   | Fichier de test                               | Oracle (ce que la spec exige)                                                     |
| ---------------- | -------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| SPEC-002-01-SC01 | domaine  | `payments/payment-provider-selection.spec.ts` | registre prod : `has('cash')`, pas `mock`, `get('mock')` → `PROVIDER_UNAVAILABLE` |
| SPEC-002-01-SC02 | use case | idem (avec `buildPaymentsService`)            | `createPayment(mock)` → `PROVIDER_UNAVAILABLE`, 0 paiement écrit                  |
| SPEC-002-01-SC03 | use case | idem                                          | webhook mock signé → `PROVIDER_UNAVAILABLE`, paiement `pending`                   |
| SPEC-002-01-SC04 | revue    | `review.md`                                   | la boucle saute les fournisseurs non enregistrés                                  |
| SPEC-002-01-SC05 | domaine  | idem                                          | dev et test : `cash` + `mock`                                                     |
| SPEC-002-01-SC06 | domaine  | idem                                          | sélection par capacité, code quelconque                                           |
| SPEC-002-02-SC01 | domaine  | idem                                          | prod : mock inactif, sans config, drapeau off ; cash actif                        |
| SPEC-002-02-SC02 | domaine  | idem                                          | dev : cash + mock actifs, drapeau on                                              |
| SPEC-002-02-SC04 | domaine  | idem                                          | prod : désactiver les configs existantes de `mock`, pas `cash`                    |
| SPEC-002-02-SC03 | domaine  | idem                                          | codes sandbox = `['mock']`                                                        |

## Commandes de vérification

```bash
pnpm --filter @djafat/api exec vitest run src/modules/payments
pnpm check:specs
pnpm verify:fast
pnpm verify
```

## Critères de fin

- [x] Tests écrits avant le code, échec constaté, puis verts
- [x] `pnpm verify` : aucun nouvel échec
- [x] Revue sans constat bloquant
- [x] `pr.md` préparé
