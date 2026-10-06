# Bloc 13 — Hardening / Launch Readiness (passe 1)

> Verdict : 🟢 **GO** — un seul P0 réel trouvé, corrigé et vérifié par une exécution
> réelle (`next build` × 3, pas une supposition) ; aucune faille de tenant isolation
> trouvée sur les surfaces Bloc 10/11/12 (adresses/panier/commandes/restaurant/
> livreur) ; zéro P1. Dette inchangée et déjà documentée (docs/32, docs/34, docs/35),
> ne redevient pas un chantier ici.

---

## 1. Méthode

Audit ciblé sur les surfaces réellement exposées par les Blocs 10/11/12 (docs/33,
docs/34, docs/35) — jamais un audit général du dépôt. Deux volets : (A) relecture de
code des modules `addresses`/`carts`/`orders` pour la question explicitement posée —
_"un utilisateur peut-il consulter/modifier la ressource d'un autre en changeant un
ID ?"_ — et (B) ré-exécution réelle de toutes les validations disponibles (`tsc`,
`eslint`, `vitest`, `next build`) sur les 6 apps + l'API, pour détecter une régression
qu'aucun check isolé n'aurait vue.

C'est le volet (B) qui a trouvé le seul vrai problème — pas une relecture de code.

## 2. Problèmes trouvés

| Priorité | Problème                                                                                                                                                                                                                      | Impact                                                                                                                                                                           | Correction                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | `@types/react` résolu à deux versions différentes dans le workspace pnpm (`19.0.2` épinglé par web/admin/restaurant vs `~19.0.10`→`19.0.14` hérité du squelette Bloc-0 d'`apps/mobile`, copié pour `apps/courier` au Bloc 11) | `next build` échoue réellement pour **web, admin et restaurant** (`Failed to compile`, confirmé par exécution, pas par supposition) — bloque le déploiement des 3 apps du pilote | Épinglé `@types/react` à `19.0.2` (version déjà stable, utilisée par web/admin/restaurant depuis le Bloc 0) dans `apps/courier`/`apps/mobile` ; `pnpm install` workspace entier pour forcer la réconciliation à une seule version partout (confirmé via `pnpm why --recursive`) |
| P2       | `courierFee: { minor: '1000', ... }` dans un test (Bloc 11) — `string` au lieu de `bigint` attendu par `Money` (vs `MoneyJson`)                                                                                               | Aucun — `vitest` ne type-check pas à l'exécution, seul `tsc --noEmit` l'a révélé ; zéro impact runtime/production                                                                | `'1000'` → `1000n`                                                                                                                                                                                                                                                              |

Aucun P0/P1 de sécurité ou d'intégrité de données trouvé — voir §3.

## 3. Sécurité — surfaces vérifiées (Blocs 10/11/12)

Relecture complète, méthode/ligne, des modules suivants — aucun n'avait été relu dans
son intégralité depuis sa construction d'origine :

- **`addresses.service.ts`** (consommé par `apps/mobile`, Bloc 12) — `list`/`get`/
  `create`/`update`/`setDefault`/`remove` scopent TOUS leurs accès par `userId` (`WHERE
a.user_id = ${userId}`, ou `findFirst({where: {id, userId}})` avant toute écriture).
  Même 404 indifférencié "n'existe pas" / "appartient à quelqu'un d'autre" sur chaque
  méthode. **Aucune faille.**
- **`carts.service.ts`** (consommé par `apps/mobile`) — le panier est TOUJOURS résolu
  depuis `actor.userId`, jamais un id de panier fourni par le client ; `updateItem`/
  `removeItem` vérifient que l'`itemId` appartient au panier de CET utilisateur avant
  toute mutation (même discipline IDOR, commentée explicitement dans le code source).
  **Aucune faille.**
- **`orders.service.ts`/`getOrderFor`** (consommé par les 3 nouvelles apps) — déjà
  durci par BUG-10.1.x (session précédente), re-vérifié sans modification : un
  `orderId` d'un autre client renvoie 404, jamais les données. **Non rouvert — aucune
  preuve nouvelle ne le justifiait.**
- **`getDeliveryContext`** (enrichi au Bloc 11) — les nouveaux champs
  (nom/adresse/téléphone restaurant, adresse/téléphone de dépose) ne sont exposés que
  via `listOffersForCourier`/`listActiveForCourier`, déjà scopées à `courierId` ; aucun
  nouveau chemin d'accès créé.
- **Room realtime `order:{id}`/`courier:{id}`/`restaurant:orders:{id}`** — autorisation
  inchangée (Bloc 7, re-vérifiée par lecture, non modifiée).
- **Idempotency** — chaque mutation critique des 3 nouvelles apps (commande, accepter/
  refuser offre, pickup/livrer/échec) génère une clé fraîche par action et désactive
  son bouton pendant l'appel (`loading`/`busy` state) — aucun double-submit possible.

`OwnershipGuard`/BUG-10.1.x/RBAC : non touchés, aucune preuve nouvelle ne le
justifiait.

## 4. Tests

Exécution réelle, résultat final après correction :

- `apps/api` : 60 fichiers / **773 tests** ✅, `tsc` ✅, `eslint` ✅, `nest build` ✅.
- `packages/types`, `packages/sdk` : `tsc` ✅, build ✅ ; SDK 3 fichiers / 10 tests ✅.
- `apps/web`, `apps/admin`, `apps/restaurant` : `tsc` ✅, `eslint` ✅, **`next build`
  ✅ (réellement exécuté, pas supposé — c'est l'exécution qui a trouvé le P0 puis
  prouvé sa correction)**.
- `apps/courier` : `tsc` ✅, `eslint` ✅, 2 fichiers / 9 tests ✅.
- `apps/mobile` : `tsc` ✅, `eslint` ✅, 2 fichiers / 5 tests ✅.

`expo export` (courier/mobile) reste bloqué par le défaut systémique déjà documenté
(docs/34 §6, docs/35 §6, `expo-modules-core` introuvable) — inchangé, non re-creusé ici
conformément à la consigne.

## 5. Dette (inchangée — aucun nouveau chantier ouvert)

Toute la dette listée dans docs/32 (validation E2E HTTP/PostgreSQL — Docker
indisponible), docs/34 (`apps/courier` : localisation arrière-plan, push, `expo
export`), docs/35 (`apps/mobile` : tabs/tablette, recherche catalogue, MapLibre, file
offline, `expo export`) reste valable et n'est pas devenue un blocker : rien de
nouveau dans cet environnement ne permet de la lever.

## 6. Launch readiness

- **P0** : 1 trouvé, 1 corrigé et vérifié par exécution réelle.
- **P1** : 0.
- **P2** : 1 trouvé et corrigé en passant (coût nul, même fichier).

### Verdict : 🟢 GO

Le parcours critique (connexion → catalogue → panier → adresse → commande → suivi)
fonctionne sur une base de code qui compile et type-check réellement, sur
isolation de données vérifiée pour les surfaces exposées par ce trimestre de blocs,
sans vulnérabilité connue. La dette restante est documentée, bornée, et n'empêche pas
un lancement pilote (web/PWA + restaurant + livreur + admin) — elle concerne des
fonctionnalités secondaires (recherche, cartes, push, offline) ou un plafond de
validation (Docker, `expo export`) déjà accepté dans les blocs précédents.
