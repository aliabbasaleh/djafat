# FEAT-002 — Revue qualité

Revue faite par l'agent principal, en relisant les specs (SPEC-002-01@1,
SPEC-002-02@2) avant le diff. Le sous-agent `spec-reviewer` n'a pas été invoqué.

## 1. Résultats déterministes

- Tests écrits **avant** le code. Le premier run a échoué faute du module
  `payment-provider-selection`, puis les tests sont passés au vert.
  SPEC-002-02-SC04, ajouté en v2, a lui aussi échoué avant d'être implémenté.
- `apps/api/src/modules/payments` : 58/58 ✅ (6 fichiers, dont 9 tests FEAT-002).
- Exécution réelle du seed sur PostgreSQL 16 + PostGIS (local), état des tables
  après chaque passage :

  | Passage                                    | `payment_providers`   | `payment_provider_configs`      | drapeau mock |
  | ------------------------------------------ | --------------------- | ------------------------------- | ------------ |
  | 1. base neuve, `NODE_ENV=production`       | cash=true, mock=false | cash                            | false        |
  | 2. puis `NODE_ENV=development`             | cash=true, mock=true  | cash, mock                      | false (¹)    |
  | 3. puis `NODE_ENV=production`, avant la v2 | cash=true, mock=false | cash, **mock activé** ← écart   | false        |
  | 3. puis `NODE_ENV=production`, avec la v2  | cash=true, mock=false | cash activé, **mock désactivé** | false        |

  (¹) Une ligne de drapeau existante n'est pas réécrite hors production :
  comportement d'origine conservé (les bascules manuelles restent). Sur une
  base de dev neuve, le drapeau est créé activé (SC02).

- `verify` complet : voir `verification.md`.

## 2. Constats de revue

| #   | Sévérité | Emplacement                                        | Constat                                                                                                                                                                                                                      | Justification                                                | Correction attendue                                                                                                                                                                 |
| --- | -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | corrigé  | `apps/api/prisma/seed.ts`                          | Trouvé en exécution réelle : rejoué en production, le seed v1 laissait la configuration de disponibilité `mock` activée. Corrigé en v2 (R3 + SC04).                                                                          | SPEC-002-02 R3                                               | Fait (`configsToDisable`).                                                                                                                                                          |
| 2   | majeur   | `apps/api/src/modules/payments/payments.module.ts` | Le câblage de la factory (`AppConfigService.isProduction` → sélection) n'est couvert par aucun test qui démarre Nest. Les tests prouvent la sélection et le service, pas l'injection elle-même.                              | Un test entièrement mocké n'est pas une preuve d'intégration | Ajouter un test d'intégration qui démarre l'API avec `NODE_ENV=production` et vérifie `POST /v1/payments` mock → 404. À faire avec la réparation de la suite d'intégration (PR #1). |
| 3   | note     | `payments.service.ts:806`                          | **Preuve de revue de SPEC-002-01-SC04** : `listAvailablePaymentMethods` fait `if (!this.registry.has(providerCode)) continue;` avant toute ligne de résultat. Un fournisseur absent du registre ne peut donc pas être listé. | SPEC-002-01 SC04                                             | Aucune.                                                                                                                                                                             |
| 4   | note     | `packages/types/src/payment-provider.ts`           | `sandboxOnly` est optionnel : un fournisseur réel futur est autorisé par défaut. C'est voulu (FEAT-002-Q03), mais cela suppose que chaque futur fournisseur de test pense à le déclarer.                                     | Choix documenté                                              | Rappel dans la revue de tout nouveau `PaymentProvider`.                                                                                                                             |
| 5   | note     | `MockPaymentProvider` (`MOCK_WEBHOOK_SECRET`)      | Le secret du webhook mock reste une constante du code source. Ce n'est plus exploitable en production, puisque le fournisseur n'y est jamais enregistré (SC03 testé).                                                        | FEAT-002 AC02                                                | Aucune dans ce périmètre.                                                                                                                                                           |

Axes couverts :

- exactitude par rapport à chaque scénario ;
- régressions : les 49 tests paiement existants passent, dev et test sont inchangés (SC05) ;
- règle « aucun `if (provider === …)` » : respectée, la décision est pilotée par une capacité (SC06) ;
- DAG : aucune nouvelle arête, `check:arch` vert ;
- sécurité : webhook forgé refusé (SC03) ;
- abstraction : un seul helper pur, aucune interface ajoutée.

## 3. Verdict

**Prêt pour PR**, sans constat bloquant. Un constat majeur reste suivi : le
test d'intégration du câblage, à faire avec la réparation de la suite d'intégration.
