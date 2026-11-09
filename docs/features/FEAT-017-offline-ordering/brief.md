---
feature: FEAT-017
specs: [SPEC-017-01@1, SPEC-017-02@1, SPEC-017-03@1]
---

# FEAT-017 — Brief d'exécution

## Fichiers concernés

| Fichier                                                    | Changement                                          | Couche      |
| ---------------------------------------------------------- | --------------------------------------------------- | ----------- |
| `packages/core/src/order/offline-message.ts`               | **nouveau** : format, somme de contrôle (pur)       | domain      |
| `apps/api/src/modules/auth/whatsapp-inbound.service.ts`    | message `DJF1` → événement `order_message.received` | application |
| `apps/api/src/modules/auth/whatsapp-text-reply.service.ts` | **nouveau** : réponse WhatsApp (Cloud ou mock)      | adapter     |
| `apps/api/src/modules/admin/offline-orders.service.ts`     | **nouveau** : passer la commande, répondre          | application |
| `apps/api/src/modules/users/users.service.ts`              | `findByPhone`                                       | application |
| `apps/api/src/modules/catalog/catalog.service.ts`          | `findRestaurantIdByRef`                             | application |
| `apps/web/src/lib/offline-order.ts`                        | **nouveau** : clé, liens, nouvel essai              | ui          |
| `apps/web/src/app/panier/page.tsx`                         | nouveaux essais, encadré hors connexion             | ui          |

## Stratégie de test

| Scénarios             | Niveau             | Fichier                                                     |
| --------------------- | ------------------ | ----------------------------------------------------------- |
| SPEC-017-01-SC01…SC04 | unitaire (pur)     | `packages/core/src/order/offline-message.spec.ts`           |
| SPEC-017-02-SC01…SC05 | application (faux) | `apps/api/src/modules/admin/offline-orders.service.spec.ts` |
| SPEC-017-02-SC06      | exécution réelle   | `scripts/e2e/offline-order.mjs`                             |
| SPEC-017-03-SC01…SC02 | unitaire           | `apps/web/src/lib/offline-order.spec.ts`                    |
| SPEC-017-03-SC03      | capture réelle     | `assets/offline-panel.png`                                  |

## Vérification

`pnpm verify:fast`, puis `node scripts/e2e/offline-order.mjs` contre l'API réelle.
