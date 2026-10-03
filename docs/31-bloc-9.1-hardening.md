# Bloc 9.1 — Architectural Hardening (restaurant ownership + MFA)

> Verdict : 🟢 **PASS WITH DEBT** — les deux dettes du mandat sont traitées : la source de
> vérité pour l'autorité restaurant est unifiée sur `user_roles` (`ownerUserId` redevient
> une métadonnée non-autoritative) ; `grantRole`/`revokeRole` sont step-up-gatées, et
> depuis BUG-3, `MFA_REQUIRED_ROLES` pilote RÉELLEMENT cette décision (`actor.roles ∩
MFA_REQUIRED_ROLES`, via `@RequireStepUp(MFA_REQUIRED_ROLES)`) — pas seulement une
> coïncidence de valeurs avec un `@RequireRole` codé en dur, comme la première version de
> cette correction le laissait croire (une revue indépendante l'a détecté avant publication
> finale ; voir §3.4). Dette explicitement assumée, pas cachée : `suspend`/`block`/
> `reactivate` (users) et `suspend`/`reinstate` (couriers/restaurants) restent sans
> step-up, parce qu'ils sont déjà câblés dans l'Admin UI livrée sans aucune UI de step-up —
> les gater aurait cassé une fonctionnalité opérationnelle pour fermer un trou de sévérité
> moindre, en construisant au passage une UI hors périmètre. Décisions validées
> explicitement par le donneur d'ordre avant implémentation. Aucune migration. Aucune
> fonctionnalité Bloc 10 commencée.

---

## 1. Contexte et périmètre

Ce bloc n'ajoute aucune fonctionnalité métier — il corrige deux dettes architecturales
identifiées à la clôture du Bloc 9 (docs/30 §6, §9) : (A) la duplication de source de
vérité pour l'autorité restaurant (`Restaurant.ownerUserId` vs `user_roles.scope_restaurant_id`),
(B) `MFA_REQUIRED_ROLES` jamais appliqué. Exclusions explicites du mandat respectées :
pas de dashboard restaurant, pas de payout, pas de notifications frontend, pas de refonte
RBAC/auth, pas de migration destructive.

## 2. Partie A — Source de vérité ownership restaurant {#restaurant-ownership}

### 2.1 Audit (RÈGLE CTO N°1)

Tous les consommateurs des deux mécanismes ont été tracés avant toute modification :
`realtime` (room auth), `orders.confirm/ready/reject`, `restaurants/me/balance`
utilisaient déjà `user_roles.scope_restaurant_id` via `isMemberOfRestaurant` (primitif
pré-existant, Bloc 7/9). Seul `catalog-management.controller.ts` (écriture menu/
restaurant) utilisait encore `Restaurant.ownerUserId` via `@RequireOwnership` — un guard
conçu pour une égalité mono-propriétaire, architecturalement incapable d'exprimer une
question de membership (plusieurs staff possibles par restaurant).

### 2.2 Décision

`user_roles` (rôles `restaurant_owner`/`restaurant_staff`) devient l'**unique** source
d'autorité restaurant. `Restaurant.ownerUserId` est **conservé** comme métadonnée
catalogue (quel compte a enregistré le restaurant — affichage admin) mais **plus jamais
consulté pour une décision d'autorisation**. Les deux notions sont désormais distinctes
et documentées comme telles partout où elles coexistent.

### 2.3 Implémentation

`RestaurantsManagementService.assertCanManage(actorUserId, restaurantId, isAdminTier)`
devient le point de contrôle unique pour toute écriture catalogue : admin bypass total
(jamais de requête `user_roles`), sinon `isMemberOfRestaurant`. `menu-categories.service.ts`
et `products-management.service.ts` résolvent le restaurant propriétaire de la ressource
puis délèguent à ce point unique. `catalog-management.controller.ts` : les 7
`@RequireOwnership(...)` sont retirés au profit de ce contrôle service-side — même
pattern que `orders.confirm/ready/reject` établi en Bloc 9, pas une nouvelle architecture.

**Conséquence assumée, pas un bug** : créer un restaurant (`POST /restaurants`) fixe
`ownerUserId` (métadonnée) mais n'accorde plus aucun scope `user_roles` — une étape
séparée (admin via `POST /admin/users/:id/roles`, déjà livré en Bloc 9) est désormais
nécessaire avant que le créateur puisse gérer ce qu'il a créé. Documenté, pas automatisé :
l'automatiser exigerait de contourner la politique anti-auto-escalade de
`UsersService.grantRole` (interdiction stricte de se cibler soi-même) — hors périmètre.

### 2.4 Tests

15 tests `restaurants-management.service.spec.ts` (dont la preuve clé : un non-membre est
rejeté même s'il EST `Restaurant.ownerUserId` — aucune divergence silencieuse possible
entre ownership et rôle), 4 `menu-categories.service.spec.ts`, 7
`products-management.service.spec.ts` — tous exécutés, 631/631 (base @djafat/api) à la
clôture de cette partie. Dans `catalog.int.spec.ts` : **3 nouveaux** scénarios
adversariaux (staff A ne peut créer une catégorie pour le restaurant B ; staff A ne peut
modifier un produit du restaurant B ; staff scopé À CE restaurant, sans entrée
`ownerUserId`, PEUT gérer son menu — la preuve inverse du correctif), plus le test
préexistant "full flow" réécrit avec une assertion 403 intermédiaire prouvant que
`ownerUserId` seul est désormais insuffisant. Écrits, non exécutés (Docker indisponible).

Voir CHECKPOINT BUG-1 / BUG-1-VERIFY (rapport de session) pour le détail complet.

## 3. Partie B — MFA_REQUIRED_ROLES {#mfa-effective}

### 3.1 Audit (RÈGLE CTO N°1)

`MFA_REQUIRED_ROLES` (`@djafat/types`, `['admin','super_admin']`) n'était importé nulle
part dans l'API — confirmé par grep exhaustif. L'architecture voulue (docs/19 D-13) ne
bloque jamais le login : le "2FA au login" est obtenu PAR CONSTRUCTION via
`@RequireStepUp()` sur chaque action privilégiée (propriété de sécurité équivalente,
complexité bien moindre). Ce mécanisme existe et fonctionne (TOTP, fenêtre de step-up,
guard — tous testés) mais n'était câblé que sur 4 routes (`settlements.record`,
`payments.refund`, `auth.mfa.disable`, le proof-of-concept `admin/sensitive-ping`) —
aucune d'elles appelée par l'Admin UI livrée. Les véritables mutations admin sensibles de
Bloc 9 (`grantRole`/`revokeRole`, `suspend`/`block`/`reactivate`, couriers/restaurants
suspend) n'avaient **aucun** step-up, alors qu'elles SONT, par leur propre documentation,
des "actions privilégiées" — rompant la garantie dont dépend tout le design D-13.

Découverte additionnelle pendant l'investigation : NestJS exécute les guards empilés dans
l'ordre d'APPLICATION des décorateurs (bas vers haut), donc `StepUpGuard` s'exécutait
avant `RolesGuard`/`PermissionsGuard` partout où `@RequireStepUp()` était écrit en
dernier (convention existante sur les 4 routes déjà gatées) — un acteur au mauvais rôle
y recevait 428 plutôt que 403. Non exploitable (aucun contournement d'autorisation, juste
un code d'erreur moins précis pour un acteur de toute façon refusé) donc non traité comme
bug séparé, mais corrigé pour les deux nouvelles routes de cette partie (ordre inversé :
rôle/permission avant step-up).

### 3.2 Décision (validée explicitement avant implémentation)

Gater `grantRole`/`revokeRole` uniquement avec `@RequireStepUp()` — la seule action dont
la compromission crée un accès persistant (contrairement à suspend/block/reactivate,
réversibles). Les autres mutations admin restent non gatées : elles sont câblées dans
l'Admin UI livrée (`apps/admin/.../users/[id]/page.tsx`, `.../couriers/page.tsx`) sans
aucune UI de step-up — les gater casserait une fonctionnalité opérationnelle pour fermer
un trou de sévérité moindre, en exigeant de construire une UI MFA hors périmètre de ce
bloc. `@RequireStepUp()` est placé AVANT `@RequireRole`/`@RequirePermission` dans le code
source (donc après eux à l'exécution) : un acteur au mauvais rôle reste rejeté 403, sans
jamais voir la question du step-up.

**Correction (BUG-3)** : la première version de cette décision (ci-dessus, inchangée dans
son principe) affirmait que "le step-up ne s'applique qu'aux acteurs déjà
`MFA_REQUIRED_ROLES`" — vrai en EFFET observable, faux en CAUSALITÉ : `@RequireStepUp()`
ne prend aucun argument, `@RequireRole('admin', 'super_admin')` est un littéral codé en
dur qui ne référence pas la constante. Modifier `MFA_REQUIRED_ROLES` n'aurait changé
AUCUN comportement — seule une coïncidence de valeurs faisait croire le contraire. Voir
§3.4.

### 3.3 Tests

`users-admin.controller.spec.ts` (exécutés — 8 à la clôture initiale de BUG-2, **10**
après la réécriture de BUG-3, §3.4) relie `MFA_REQUIRED_ROLES` au wiring réel des guards
par réflexion sur la classe de production (pas un mock) — garde-fou automatisé contre
toute régression future de cet ordre ou de ce périmètre. **8** scénarios adversariaux
ajoutés dans `admin-rbac.int.spec.ts` (sans-enrôlement→428 ; rôle-interdit→403-pas-428 ;
enrôlement+step-up ouvre la fenêtre ; auto-escalade toujours bloquée même stepped-up ;
cross-grant admin/super_admin toujours bloqué ; grant légitime stepped-up + audit loggé ;
refresh ne casse ni ne contourne le step-up ; refresh d'un acteur jamais-stepped-up reste
bloqué par le rôle), écrits, non exécutés (Docker indisponible).

Voir CHECKPOINT BUG-2 / BUG-2-VERIFY (rapport de session) pour le détail complet.

### 3.4 BUG-3 — la causalité manquante, et sa correction

Une revue indépendante a démontré (grep exhaustif de `MFA_REQUIRED_ROLES` sur tout le
repo, puis sur `@RequireRole`/`@RequireStepUp`) que la constante n'était importée nulle
part en dehors de son propre fichier de définition et d'un test. `@RequireStepUp()` a la
signature `(): ...` — zéro paramètre, ne peut consulter aucune liste de rôles. La
protection de `grantRole`/`revokeRole` fonctionnait réellement, mais par la coïncidence
que `@RequireRole('admin', 'super_admin')` (littéral) listait exactement les deux mêmes
rôles que `MFA_REQUIRED_ROLES` — pas par une dépendance causale.

**Correction (minimale, additive)** : `@RequireStepUp()` accepte désormais un paramètre
optionnel `mfaRequiredRoles?: readonly Role[]`. Sans argument, comportement strictement
inchangé (`SetMetadata(REQUIRE_STEP_UP_KEY, true)` — toujours la forme utilisée par
`settlements`/`payments`/`sensitive-ping`/`mfa.disable`, vérifié par test que leur
métadonnée reste exactement `true`). Avec un argument, `StepUpGuard` calcule
`actor.roles ∩ mfaRequiredRoles` : rôle hors de la liste → step-up non exigé (retour
anticipé, avant même la lecture de session) ; rôle dans la liste → comportement de
step-up inchangé (fraîcheur de session, fenêtre, 428 sinon). `grantRole`/`revokeRole`
appellent désormais `@RequireStepUp(MFA_REQUIRED_ROLES)` — la constante RÉELLEMENT
importée du package `@djafat/types` et passée par référence (prouvé par
`toBe(MFA_REQUIRED_ROLES)`, égalité de référence, pas de valeur). `RolesGuard` reste
l'unique décideur d'autorisation — ce paramètre ne fait jamais gagner ni perdre un droit
d'accès, il décide seulement si le second facteur s'applique à un acteur qui a déjà
franchi `@RequireRole`/`@RequirePermission`.

**Fichiers modifiés** : `auth/decorators.ts`, `auth/guards/step-up.guard.ts`,
`admin/users-admin.controller.ts`. **Fichiers de test** :
`auth/guards/step-up.guard.spec.ts` (+9, dont les scénarios A-E demandés : rôle dans la
politique sans step-up → requis ; rôle hors politique → exempté sans même lire la
session ; retrait d'un rôle de la politique → cet acteur devient exempté ; ajout d'un
rôle → cet acteur devient soumis), `admin/users-admin.controller.spec.ts` (preuve
d'identité de référence). Voir CHECKPOINT BUG-3 / BUG-3-VERIFY (rapport de session) pour
le détail complet.

## 4. Dette résiduelle explicite

- `suspend`/`block`/`reactivate` (users), `suspend`/`reinstate` (couriers), `suspend`
  (restaurants) : toujours sans step-up. Fermer complètement nécessite une UI MFA dans
  l'Admin frontend (hors périmètre explicite de ce bloc).
- Ordre d'exécution des guards pré-existant sur `settlements.record`/`payments.refund`/
  `sensitive-ping` (StepUpGuard avant Role/Permission) : non corrigé, non introduit par ce
  bloc, non exploitable (dégrade seulement la précision du code d'erreur).
- Aucune infrastructure Docker/PostgreSQL disponible dans cet environnement — tous les
  `.int.spec.ts` (Part A et B) restent écrits, non exécutés.
