---
feature: FEAT-011
specs: [SPEC-011-01@1]
---

# FEAT-011 — Brief d'exécution

## Fichiers concernés

| Fichier                                                      | Changement                                                                   | Couche       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------ |
| `apps/api/src/modules/admin/phone-orders.service.ts`         | **nouveau** : composition compte, adresse, panier, commande, paiement, audit | application  |
| `apps/api/src/modules/admin/phone-orders.controller.ts`      | **nouveau** : `POST /admin/phone-orders`                                     | transport    |
| `apps/api/src/modules/admin/dto/phone-order.schema.ts`       | **nouveau** : schéma strict                                                  | transport    |
| `apps/api/src/modules/admin/admin.module.ts`                 | importe `addresses`, `carts`, `orders`, `payments`                           | composition  |
| `apps/api/src/modules/{orders,payments}/*.module.ts`         | exportent `OrdersService`, `PaymentsService`                                 | composition  |
| `apps/api/src/common/audit/audit.service.ts`                 | action `ORDER_PLACED_BY_PHONE`                                               | application  |
| `packages/sdk/src/admin.ts`                                  | `admin.phoneOrders.place`                                                    | transport    |
| `apps/admin/src/app/admin/phone-order/page.tsx` (+ css)      | **nouveau** : écran                                                          | presentation |
| `apps/admin/src/app/admin/layout.tsx`, `lib/auth-storage.ts` | accès `support`, menu réduit pour lui                                        | presentation |

## Réutilisation

`UsersService.findOrCreateByPhone`, `AddressesService.create/list`, `CartsService.clearCart/addItem`,
`OrdersService.createOrder` (prix, ouverture, instantané d'adresse), `PaymentsService.listMethodsForOrder/createPayment`
(capacité `collectedOnDelivery`), `IdempotencyService`, `AuditService`. Aucune table nouvelle.

## Stratégie de test

| Scénarios             | Niveau             | Fichier                                                   |
| --------------------- | ------------------ | --------------------------------------------------------- |
| SPEC-011-01-SC01…SC04 | application (faux) | `apps/api/src/modules/admin/phone-orders.service.spec.ts` |
| SPEC-011-01-SC05      | exécution réelle   | `e2e-demo.md`                                             |

## Vérification

`pnpm verify:fast` ; parcours réel dans l'admin (navigateur) jusqu'à la livraison.
