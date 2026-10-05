# Pre-Bloc 10 — Isolation tenant (famille BUG-10.1.x)

> Verdict : 🟢 **PASS WITH DEBT** — quatre failles d'isolation tenant fermées, plus la
> cause racine qu'elles partageaient. Aucune permission RBAC modifiée, aucun changement
> MFA/realtime/Admin UI, aucune migration. La dette restante est unique et explicite :
> aucun test HTTP réel n'a pu être exécuté (Docker indisponible dans cet environnement),
> donc chaque garde est prouvée au niveau service/guard contre les vraies classes, pas à
> travers un round-trip complet.

---

## 1. Pourquoi ce document

L'audit pré-Bloc 10 a montré que l'app restaurant allait multiplier les routes
tenant-scopées. Quatre défauts de la même famille ont été trouvés et corrigés avant de
commencer. Ils ne sont pas quatre bugs indépendants : ce sont **quatre symptômes d'une
seule ligne de code**.

## 2. La cause racine

`OwnershipGuard` acceptait l'`overridePermission` comme preuve de statut staff :

```ts
if (overridePermission && actor.permissions.includes(overridePermission)) return true;
```

Or le seed accorde `orders:read` à `restaurant_owner`, `restaurant_staff` ET `courier` ;
`deliveries:read`/`deliveries:write` à `courier`. Un acteur tenant-scopé détenant une
permission pour **ses** ressources obtenait donc l'accès à **toutes**. Deux aggravants :

- l'override est évalué **avant** le resolver d'ownership, qui n'était donc jamais appelé ;
- `unionFromStatuses` fait l'**union** des statuts autorisés de **tous** les rôles de
  l'acteur — et `customer` est accordé automatiquement à la création de tout compte
  (`users.service.ts`), donc **tout livreur réel détient `courier + customer`**.

## 3. Les quatre défauts

| Réf        | Endpoint                      | Nature                                                                                    | Sévérité    |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| BUG-10.1   | `GET /orders/:id`             | lecture inter-tenant (panier, `customerId`, **conditions de commission** d'un concurrent) | MEDIUM-HIGH |
| BUG-10.1.1 | `POST /deliveries/:id/fail`   | **écriture** : tout livreur pouvait faire échouer la course d'un autre                    | HIGH        |
| BUG-10.1.2 | `GET /deliveries/:id`         | lecture inter-tenant (frais du livreur, chronologie)                                      | LOW-MEDIUM  |
| BUG-10.1.3 | `POST /deliveries/:id/cancel` | **écriture** : un `courier+customer` pouvait annuler la livraison d'autrui                | HIGH        |

BUG-10.1.3 avait d'abord été classé « non exploitable » : `courier` ne figure sur aucune
transition `→ cancelled`. Conclusion juste pour un acteur **mono-rôle**, fausse dès que
l'union entre en jeu. La leçon est consignée ici parce qu'elle est générale : **ne jamais
raisonner sur un acteur mono-rôle.**

## 4. La règle unique

`common/authz/order-access.ts` — pure, sans DI, importable depuis tout module
(`api-common`). Chaque appelant collecte les faits avec ce qu'il a le droit d'atteindre,
puis demande la décision. Pourquoi pure plutôt qu'injectable : `DeliveriesService` injecte
`ORDER_AMOUNT_PORT` (lié à `OrdersService`) ; une policy injectable ayant besoin de
`DELIVERY_TRACKING_PORT` aurait fermé un cycle de constructeur. Côté `orders`, ce port est
résolu paresseusement via `ModuleRef` (même motif que `OwnershipGuard`).

- **Commandes** : staff-tier → client propriétaire → membre du restaurant de _cette_
  commande → courier _actuellement assigné_ → sinon DENY (404, jamais 403 : « pas à toi »
  doit rester indistinguable de « inexistant »).
- **Livraisons** : courier assigné → client propriétaire → staff-tier → membre restaurant
  (si permission) → sinon DENY.
- **`fail`** : seul le courier **actuellement assigné**, ou staff-tier.
- **`cancel`** : seul le client **propriétaire** de la commande, ou staff-tier.

`staff-tier` = rôle ∈ {admin, super_admin, support, finance} **ET** détention de la
permission. C'est un **resserrement strict** : il ne peut que refuser un acteur que
l'ancienne règle autorisait, jamais l'inverse. Extrait dans `common/authz/staff-tier.ts`
car la notion n'est pas propre aux commandes.

## 5. Atomicité

Un contrôle explicite seul est read-then-act. Les deux écritures portent donc une seconde
couche, dans la transaction :

```sql
-- fail : la ligne doit TOUJOURS appartenir à l'acteur au moment de l'écriture
AND (:isStaff OR courier_id = :actor)
-- cancel : la ligne doit TOUJOURS être la commande contre laquelle on a autorisé
AND (:isStaff OR order_id = :authorizedOrderId)
```

Les prédicats utilisent des **paramètres liés simples** : interpoler un fragment
`Prisma.sql` dans un template `$queryRaw` n'est pas une composition supportée et serait
lié comme valeur au lieu d'être inséré comme SQL — erreur commise puis corrigée ici.

## 6. Correctif de fond

`OwnershipGuard` exige désormais un rôle staff-tier en plus de la permission. Impact
aujourd'hui : **nul** — les 3 overrides restants (`payments:read` ×2, `payments:write`)
ne sont détenus que par support/finance/admin/super_admin. Bénéfice : le prochain
`@RequireOwnership(..., 'x:y')` posé sur une permission qu'un rôle tenant détient ne peut
plus rouvrir la faille.

## 7. Preuves

**Matrice exhaustive `cancel`** — 14 combinaisons de rôles × propriétaire/non-propriétaire,
contre le vrai `DeliveriesService`, avec les permissions exactes du seed : aucune
annulation effective sur une ligne non-propriétaire, hormis `admin`/`super_admin`. Les
quatre combinaisons réalistes incluant `customer` (`courier+customer`,
`customer+restaurant_staff`, `support+customer`, `finance+customer`) sont toutes DENY sur
la ressource d'autrui.

**Tests de mutation** — un test vert ne prouve rien s'il passe aussi sans le correctif.
Chaque protection a été neutralisée une par une :

| Protection neutralisée                 | Tests qui tombent |
| -------------------------------------- | ----------------- |
| `getOrderFor` — contrôle tenant        | 6                 |
| `getByIdFor` — contrôle tenant         | 2                 |
| `reportFailed` — contrôle explicite    | 1                 |
| `reportFailed` — prédicat atomique     | 1                 |
| `cancel` — contrôle explicite          | 8                 |
| `cancel` — prédicat atomique           | 1                 |
| `OwnershipGuard` — exigence staff-tier | 7                 |

Deux pièges méthodologiques rencontrés, corrigés, et consignés parce qu'ils se
reproduiront : (a) le faux DB déniait tout dès que le nombre de paramètres liés changeait,
donc une mutation produisait un faux « bloqué » — le faux émule désormais _le SQL tel que
fourni_ ; (b) le test de `OwnershipGuard` nommé « staff-tier » utilisait une fixture
`roles: ['customer']` — il validait en réalité le bypass bugué.

## 8. Dette restante

- **Aucun test HTTP réel** : Docker indisponible. Tous les `.int.spec.ts` restent
  WRITTEN_NOT_EXECUTED. Les gardes sont prouvées au niveau service/guard sur les vraies
  classes.
- La branche restaurant de `resolveDeliveryAccess` est inopérante par construction (aucun
  rôle restaurant ne détient `deliveries:read`) — volontaire, pour ne rien élargir.
- `POST /deliveries/:id/cancel` conservait un override jusqu'à BUG-10.1.3 ; il n'en reste
  aucun sur une route `deliveries`. Les 3 overrides `payments:*` subsistent, vérifiés sains.
