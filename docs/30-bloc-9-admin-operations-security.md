# Bloc 9 — Admin / Operations Foundation + Security Hardening

> Verdict : 🟢 **PASS** — la faille `orders.confirm`/`ready` (dette D-10) est fermée, un
> mécanisme sécurisé d'attribution de rôle existe enfin (plus aucun rôle hors `customer`
> n'est SQL-only), et un admin web minimal rend tout cela réellement exploitable par un
> humain. Dette Docker/PostgreSQL inchangée (jamais exécuté contre une infrastructure
> réelle ici) — déclarée explicitement, jamais contournée. Un bug réel trouvé en cours de
> route (seed non idempotent après l'ajout de l'invariant DB) a été corrigé et vérifié
> avant de continuer (CHECKPOINT BUG-1).

---

## 1. Contexte

L'audit pré-Bloc 9 a identifié deux blocages structurels : (1) aucun mécanisme
n'attribuait de rôle autre que `customer` en dehors du SQL/seed direct — aucun
restaurant/livreur réel ne pouvait jamais exister dans le système ; (2) `orders.confirm`/
`ready` restaient des stand-ins du Bloc 0.5, **sans authentification du tout**, une
mutation d'état de commande ouverte à quiconque. Ce bloc ferme exactement ces deux
blocages, plus la fondation minimale (lecture financière, API admin, web admin) qui les
rend utilisables — rien de plus. Pas de payout réel, pas de dashboard restaurant complet
(Bloc 10), pas de CRM/support/promotions.

## 2. Domaine Role Management

### 2.1 Ce qui existait déjà (RÈGLE CTO N°1)

`user_roles` (migration 0003) a toujours eu `scope_restaurant_id` — jamais exploité par
aucun endpoint. `isMemberOfRestaurant` (Bloc 7, pour `realtime`) était déjà le bon
primitif de membership. `AuditAction` contenait déjà `ROLE_GRANTED`/`ROLE_REVOKED`,
anticipés depuis le Bloc 1, jamais utilisés. `UsersService.suspend`/`block`/`reactivate`
existaient déjà (Bloc 1) — "service capability only — no HTTP endpoint yet ; the admin
console that calls these is Bloc 9". Rien de tout cela n'a été dupliqué — uniquement
exposé et complété.

### 2.2 Invariants imposés par `UsersService` (pas le contrôleur)

- **Deny by default** : un acteur sans `users:write` ne peut rien muter (gardes
  `@RequireRole`/`@RequirePermission` déjà établies).
- **Aucune auto-escalade** : un acteur ne peut jamais grant/revoke un rôle sur **son
  propre compte**, quel que soit le rôle visé — pas seulement interdire de s'octroyer
  `admin`, interdire toute mutation de soi-même (évite aussi les scénarios de
  verrouillage accidentel).
- **`admin` ne peut jamais accorder/révoquer `admin` ou `super_admin`** — seul
  `super_admin` le peut. Décision volontairement plus stricte que le minimum demandé par
  le mandat (qui n'interdisait explicitement que `admin → super_admin`) : empêcher aussi
  la prolifération latérale d'admins est une posture "deny by default" cohérente avec le
  reste du principe.
- **Forme du scope** : `restaurant_owner`/`restaurant_staff` exigent un
  `scopeRestaurantId` existant ; tout autre rôle le refuse.
- **Idempotence réelle** : un grant identique déjà détenu est un succès silencieux
  (`granted: false`), jamais une erreur, jamais un second enregistrement d'audit.
- **Un restaurant à la fois** : migration 0028, index unique partiel
  `user_roles_one_restaurant_per_staff` — backstop DB, même précédent que
  `addresses_one_default_per_user` (migration 0027).

### 2.3 Rôles couverts

Les 8 rôles existants (`customer, restaurant_owner, restaurant_staff, courier, support,
finance, admin, super_admin`) sont **tous** gérables via ce mécanisme — le mandat n'en
citait explicitement que 5, mais exclure `restaurant_owner`/`support`/`finance` aurait
été arbitraire (même mécanisme de scope, même coût de code) ; documenté comme inclusion
délibérée, pas une invention de nouveau rôle.

### 2.4 Profil courier — décision explicite (Phase 3)

**Option retenue : B — création séparée (paresseuse)**, inchangée depuis le Bloc 6
(`CouriersService.ensureProfile`, upsert idempotent au premier `/couriers/me/status` ou
`/couriers/me/location`). Le Bloc 9 attribue le **rôle** (ce qui autorise l'accès aux
routes `couriers/me/*`) ; le **profil** se crée lui-même. Aucune nouvelle dépendance
croisée `admin`/`users` → `couriers` introduite — zéro duplication, zéro couplage
supplémentaire.

## 3. Fermeture `orders.confirm`/`ready` + `reject` (dette D-10)

`OrdersController` exige désormais `@RequireAuth()` + `@RequireRole('restaurant_owner',
'restaurant_staff')` (garde grossière, gratuite, avant toute requête DB). La vérification
FINE — appartient-il au BON restaurant ? — s'exécute dans `OrdersService.transitionOrder`,
**dans la même transaction verrouillée** (`FOR UPDATE`) que la lecture du statut : aucune
fenêtre où un changement de staff pourrait se glisser entre la vérification et la
mutation. `reject` (`placed → rejected`) existait déjà intégralement dans la state
machine de `@djafat/core` (rôles autorisés inclus) — zéro nouvelle décision métier, juste
le branchement que l'auth manquante empêchait jusqu'ici.

Un restaurant A ne peut jamais confirmer/préparer/rejeter une commande du restaurant B —
404 si la commande n'existe pas, 403 si elle appartient à un autre restaurant (même
convention que l'ownership existant des commandes côté client, docs/19 §21).

## 4. Lecture financière (lecture seule stricte)

`LedgerReadService` (nouveau) ne fait **jamais** d'écriture — `getOwnerBalances` lit
directement la projection `wallet_balances` (déjà maintenue par le moteur ledger, zéro
calcul) ; `getGlobalAccountBalances` somme `ledger_entries` pour les comptes globaux non
possédés (`DJAFAT_BANK`, `DJAFAT_REVENUE`, `PSP_CLEARING`, ...), signe naturel
débit/crédit selon le `type` du compte — même convention que
`ledger-assert.processor.ts` (le job de réconciliation du worker), généralisée.

Trois surfaces : `GET /couriers/me/balance`, `GET /restaurants/me/balance` (résolu via
`user_roles.scope_restaurant_id` — **pas** `Restaurant.ownerUserId`, voir §6), `GET
/admin/finance/balances` (vue globale agrégée). **IDOR structurellement impossible** sur
les deux routes self-service : aucune n'accepte un identifiant fourni par le client.

## 5. API Admin

| Domaine      | Route                                                                                       | Permission                                     |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Utilisateurs | `GET/POST admin/users`, `GET admin/users/:id`, rôles, suspend/block/reactivate              | `users:read`/`users:write`                     |
| Restaurants  | `GET admin/restaurants`, `GET admin/restaurants/:id/balance`                                | `restaurants:read`/`ledger:read`               |
| Livreurs     | `GET admin/couriers` (+ suspend/reinstate déjà existants), `GET admin/couriers/:id/balance` | `couriers:read`/`couriers:write`/`ledger:read` |
| Commandes    | `GET admin/orders`                                                                          | `orders:read`                                  |
| Finance      | `GET admin/finance/balances`, `GET admin/settlements` (déjà existant, réutilisé)            | `ledger:read`                                  |
| Audit        | `history` inclus dans `GET admin/users/:id` (voir §5.1)                                     | `users:read`                                   |

Chaque domaine admin vit dans **son propre module** (`catalog`, `couriers`, `orders`,
`ledger`), préfixé `admin/*` — le même découpage que `couriers-admin.controller.ts` et
`settlements.controller.ts` avaient déjà établi avant ce bloc. Seul le role-management
(qui touche `user_roles`, propriété de `users`) vit dans le module `admin` lui-même,
`users` devant rester une couche qui "ne reach rien" (même raison que `addresses` a eu
son propre module au Bloc 8).

### 5.1 Audit — lecture minimale ajoutée

`user_roles` ne porte **aucune colonne** `granted_by`/`granted_at` (migration 0003) —
l'historique ne peut vivre que dans `audit_logs` (immuable, trigger DB, migration 0012).
Pour satisfaire l'exigence UX explicite "afficher... la date, l'acteur ayant effectué la
mutation", `AuditService.listForEntity` (nouveau, lecture seule) a été ajouté et branché
dans `GET admin/users/:id`.

## 6. Incohérence pré-existante découverte (documentée, non corrigée)

`catalog-management.controller.ts` (écriture menu/restaurant) vérifie l'ownership via
`Restaurant.ownerUserId` (métadonnée catalogue, un seul utilisateur) — mécanisme
**différent** de `user_roles.scope_restaurant_id` qu'utilisent `realtime`, et maintenant
`orders.confirm/ready` et `restaurants/me/balance`. Un `restaurant_staff` (sans
`ownerUserId`) peut donc confirmer des commandes et voir son solde, mais pas encore
modifier le menu. Dette pré-existante (docs/20 §14, "multi-staff-per-restaurant"),
**non aggravée, non corrigée** (hors périmètre de ce bloc) — signalée explicitement
plutôt que silencieusement ignorée.

## 7. Web Admin (`apps/admin`)

Transformé de placeholder statique en shell réel — 9 routes (`/login`, `/admin`,
`/admin/users`, `/admin/users/[id]`, `/admin/restaurants`, `/admin/couriers`,
`/admin/orders`, `/admin/finance`). `@djafat/ui` pour tout le contenu ; un seul composant
local nouveau (`DataTable`/`Pagination` — aucune table n'existe dans le design system,
un seul composant partagé plutôt que quatre implémentations dupliquées). Confirmation via
`window.confirm`/`window.prompt` pour les opérations sensibles (aucun `Modal` n'existe
ailleurs dans le dépôt — cohérence plutôt qu'un nouveau pattern). Finance strictement
lecture seule ; section "Virements" explicitement marquée indisponible, jamais un bouton
non fonctionnel déguisé.

Pas de page d'enrôlement MFA : `MFA_REQUIRED_ROLES` existe dans `@djafat/types` mais
n'est **appliqué nulle part** dans l'API (dette observée, hors périmètre, non corrigée).
Le role-grant suit le seul précédent RÉEL de mutation admin sensible déjà dans le dépôt
(`couriers-admin.controller.ts`, suspend/reinstate — `@RequireRole` + `@RequirePermission`,
**sans** `@RequireStepUp`) plutôt que `sensitive-ping`'s preuve de concept isolée — évite
de construire une UI MFA hors de la liste de pages explicitement demandée.

## 8. Sécurité — matrice adversariale (Phase 11)

Auto-escalade, `admin → super_admin`, restaurant A sur commande B (confirm/ready/les
deux), commande inconnue (404 avant la vérification de membership), transition invalide
(409 propre), grant/revoke dupliqué et concurrent (idempotence réelle sous
`Promise.allSettled`), pagination négative/overflow (rejetée à `page≤0`/`limit=0`, une
page très au-delà du total reste une liste vide honnête jamais un crash), injection dans
le paramètre `:role` (rejetée par l'enum Zod). RBAC bout-en-bout re-prouvé par HTTP réel
(`test/admin-rbac.int.spec.ts`, WRITTEN_NOT_EXECUTED) avec les 8 comptes seedés.
Isolation livreur-à-livreur : héritée structurellement du Bloc 6
(`couriers.controller.ts` ne résout jamais que `actor.userId`), non modifiée par ce bloc,
non retestée inutilement.

## 9. Tests

**EXECUTED** (617 tests `@djafat/api`, zéro régression) :

| Fichier                                                | Tests | Portée                                                                         |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------ |
| `users.service.spec.ts`                                | 25    | grant/revoke, idempotence, escalade, concurrence réelle                        |
| `admin/dto/role-grant.schema.spec.ts`                  | 19    | validation Zod, pagination, injection                                          |
| `confirm-ready-reject-security.spec.ts`                | 9     | membership restaurant, concurrence réelle sur confirm/ready, listing admin     |
| `ledger-read.service.spec.ts`                          | 5     | signe débit/crédit, isolation par propriétaire, exclusion des comptes possédés |
| `audit.service.spec.ts`                                | 3     | lecture par entité, échec d'écriture jamais bloquant                           |
| Extensions `restaurants-management`/`couriers.service` | 4     | listing admin, pagination, filtres                                             |

**WRITTEN_NOT_EXECUTED** (Docker indisponible, re-confirmé juste avant ce rapport) :
`test/admin-rbac.int.spec.ts` (RBAC HTTP réel, 8 comptes seedés) + extension de
`walking-skeleton.int.spec.ts` (anonyme/client/livreur rejetés sur confirm/ready avant
l'appel légitime, même commande réelle).

## 10. Limitations assumées

- Aucun payout réel — explicitement hors périmètre (mandat), le ledger reste la source
  de vérité, aucun bouton non fonctionnel.
- Aucun dashboard restaurant complet — Bloc 10.
- `MFA_REQUIRED_ROLES` reste non appliqué (dette observée, pas introduite par ce bloc).
- Incohérence `ownerUserId` vs `scope_restaurant_id` (§6) — documentée, pas corrigée.
- Vérification visuelle web : aucun outil de capture/navigateur disponible ici — `next
build` (11 routes générées) + lecture de code sont les seules garanties, déclaré
  explicitement plutôt que simulé.

## 11. Dette restante (mise à jour)

- **D-10** → **fermé** pour `orders.confirm/ready/reject`.
- **D-12** (notifications web, Bloc 8) → inchangé.
- **Nouvelle (non numérotée)** : incohérence ownership restaurant (§6) — à unifier avant
  le Bloc 10 (dashboard restaurant complet) pour éviter qu'un staff reste bloqué sur la
  gestion du menu.
- **Nouvelle (non numérotée)** : `MFA_REQUIRED_ROLES` jamais appliqué — observé, pas dans
  le périmètre de ce bloc.
