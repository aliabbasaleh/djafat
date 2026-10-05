# Bloc 11 — Courier App

> Verdict : 🟢 **PASS WITH DEBT** — `apps/courier` passe de "n'existe pas" à une
> application Expo réelle : login OTP, online/offline, offre entrante avec compte à
> rebours (accepter/refuser), navigation restaurant → client, confirmation de
> récupération, confirmation de livraison par code, signalement d'échec, gains
> (pending/available). Le backend (Bloc 6, docs/25) était déjà quasiment complet —
> seul un enrichissement additif d'un port existant (nom/adresse restaurant, adresse/
> téléphone de dépose) a été nécessaire pour que les écrans soient utilisables. Dette
> assumée et explicite : §6 — en particulier le suivi de position en **arrière-plan**
> (le point que docs/04 §4.5/§103 appelle lui-même "le plus fragile") n'est PAS
> implémenté ; seul le suivi au premier plan (app ouverte) l'est.

---

## 1. Contexte et périmètre

`apps/courier` n'existait pas du tout avant ce bloc (contrairement à `apps/restaurant`
qui avait une coquille Bloc 0) — aucun répertoire, aucune entrée dans
`pnpm-workspace.yaml` au-delà du glob générique `apps/*`. Mandat roadmap (docs/14
§107, item 34) : _"login + onboarding + attente validation ; Online/Offline géant +
résumé du jour ; offre entrante (compte à rebours, son, accepter idempotent /
refuser) ; course (aller resto → récupérer → aller client → livrer photo+code →
échec/motif) ; récap gain + relevé ; localisation arrière-plan (foreground service
Android, permission iOS justifiée, throttle, arrêt offline) ; file d'actions offline ;
gros boutons / fort contraste."_ Architecture détaillée : docs/04 §4.7.

Avant de coder, audit du backend existant (Bloc 6, docs/25) : `couriers` (profil,
statut, position, solde) et `deliveries` (offres, accepter/refuser, pickup, livrer,
échec) étaient **déjà complets et testés** — construits avant même BUG-10.1.x, dont
`canCourierActOnDelivery`/`resolveDeliveryAccess` ferment déjà l'IDOR sur toutes ces
routes. Le seul vrai manque : les listes `couriers/me/offers` et
`couriers/me/deliveries` ne renvoyaient que des coordonnées GPS, jamais un nom de
restaurant ni une adresse lisible — inutilisable pour un écran humain.

Hors périmètre, non touché : BUG-10.1.x/`OwnershipGuard`/RBAC (aucune preuve que ce
bloc en avait besoin), `apps/mobile` (Bloc 12), paiement/ledger, dispatch lui-même
(déjà construit, Bloc 6).

## 2. Ce qui manquait réellement côté API

Un seul enrichissement, additif, sur un port déjà consommé par `deliveries` pour le
dispatch — `OrderAmountPort.getDeliveryContext` (déjà la SEULE façon sanctionnée pour
`deliveries` d'apprendre quoi que ce soit sur `orders`/`restaurants`, son propre
commentaire le dit explicitement : _"`deliveries` never touches the `orders`/
`restaurants` tables directly"_). Le SELECT existant joignait déjà
`orders o JOIN restaurants r` pour les coordonnées pickup/dropoff — il suffisait de
sélectionner des colonnes supplémentaires de cette même jointure : nom/adresse/
téléphone du restaurant, et `dropoff_label`/`dropoff_quartier`/`dropoff_street`/
`dropoff_landmark`/`dropoff_recipient_phone` déjà présents sur `orders` (gelés à la
création, Bloc 8). Aucune migration, aucune nouvelle jointure, aucun nouveau
couplage DAG.

- `OrderDeliveryContext` (`@djafat/types`) : 6 champs ajoutés (`restaurantName`,
  `restaurantAddress`, `restaurantPhone`, `dropoffLabel`, `dropoffAddress`,
  `dropoffPhone`).
- `OrdersService.getDeliveryContext` : le SELECT existant sélectionne ces colonnes en
  plus ; `composeAddress()` (nouvelle fonction pure) joint quartier/rue/repère en une
  chaîne, `null` si tout est absent.
- `DeliveriesService.listOffersForCourier`/`listActiveForCourier` : chaque ligne
  reçoit un champ `context` (le `OrderDeliveryContext` complet), résolu par un appel
  au port par ligne — jamais un join direct de `deliveries` vers `orders`/
  `restaurants`.

Tout le reste (profil, statut, position, solde, offres, accepter/refuser, pickup,
livrer, échec) était déjà construit, déjà testé, et n'a pas été modifié.

## 3. Sécurité — ce qui est directement pertinent pour ce bloc

### 3.1 Aucune nouvelle surface d'autorisation

Les quatre routes `couriers/me/*` et les cinq routes `deliveries/:id/*` utilisées par
l'app existaient déjà, avec leurs propres gardes (`@RequireRole('courier')`,
`canCourierActOnDelivery`/`resolveDeliveryAccess`, jamais un `courierId` fourni par le
client — docs/25 §14, §35, §46). Rien de ce bloc n'a touché `OwnershipGuard`,
`BUG-10.1.x`, ou le RBAC. Le SEUL changement serveur est l'enrichissement de données
en lecture décrit en §2 — aucune nouvelle route, aucune nouvelle permission.

### 3.2 Le contexte enrichi ne fuit rien de nouveau

`getDeliveryContext` ne répond qu'à un appelant qui détient déjà l'`orderId` d'une
livraison qui LUI est offerte/assignée (vérifié en amont par
`listOffersForCourier`/`listActiveForCourier`, elles-mêmes filtrées par
`courierId: callerId`). Le nom/adresse/téléphone du restaurant sont déjà publics
(`GET /restaurants/:slug`) ; l'adresse/téléphone de dépose sont déjà ce que
`getDeliveryContext` exposait en coordonnées GPS — les rendre lisibles n'élargit pas
qui peut les voir, seulement sous quelle forme.

### 3.3 Idempotency-Key sur chaque mutation

`accept`/`reject`/`pickup`/`deliver`/`fail` exigent tous un en-tête
`Idempotency-Key` côté serveur (inchangé, Bloc 6) — le SDK (`createCourierClient`)
et l'app (`lib/idempotency.ts`) en génèrent un nouveau par action. Jamais de double
acceptation possible même en cas de retap réseau.

## 4. Fonctionnel livré

- **Login** (`/(auth)/login`) — OTP téléphone, refuse côté client tout compte sans
  rôle `courier`.
- **Accueil** (`/(app)/home`) — bascule géante En ligne/Hors ligne ; bannière d'offre
  entrante avec compte à rebours (restaurant, adresse de dépose, gain estimé,
  Accepter/Refuser) ; lien direct vers une livraison déjà en cours ; **temps réel**
  via la room `courier:{id}` (Bloc 7, déjà câblée côté serveur pour
  `delivery.assigned`/`delivery.accepted`) — l'événement ne fait que déclencher un
  refetch REST, jamais appliqué directement à l'état.
- **Livraison active** (`/(app)/delivery`) — avant récupération : nom/adresse/
  téléphone du restaurant + bouton "Confirmer la récupération" ; après récupération :
  adresse/téléphone du client + saisie du code à 4 chiffres + "Confirmer la
  livraison" ; à tout moment : "Signaler un problème" (motif obligatoire).
- **Gains** (`/(app)/earnings`) — solde pending/available en lecture, par devise.
- **Suivi de position au premier plan** — envoyé automatiquement (throttle ~8s)
  pendant qu'une livraison est active et que l'écran est ouvert, via l'endpoint déjà
  validé `POST /couriers/me/location`.

## 5. Tests

**Backend (nouveau, exécuté) :**

- `delivery-context-display.spec.ts` — 4 cas : champs restaurant/dropoff corrects,
  composition partielle de l'adresse, `null` (jamais chaîne vide) quand tout est
  absent, restaurant sans téléphone/adresse ne plante pas.
- `courier-listings-context.spec.ts` — 5 cas : contexte attaché par `orderId` (pas de
  join direct), liste vide → aucun appel au port, `NotFound` si la livraison d'une
  offre a disparu, contexte attaché à chaque livraison active, liste active vide.

**Frontend (nouveau, exécuté) :**

- `lib/format.spec.ts` — 7 cas (élapsed, countdown, clamp à 0).
- `lib/idempotency.spec.ts` — 2 cas (forme, unicité).

**Résultat global** : `apps/api` 60 fichiers / 773 tests ✅ ; `packages/sdk` 3
fichiers / 10 tests ✅ (inclut `courier.spec.ts`) ; `apps/courier` 2 fichiers / 9
tests ✅. `tsc`/`eslint`/`prettier` verts sur `apps/api`, `packages/types`,
`packages/sdk`, `apps/courier`.

**Non exécuté :**

- Aucun appel HTTP réel, aucune requête PostgreSQL réelle — Docker indisponible,
  dette inchangée depuis BUG-10.1.x (docs/32).
- `expo export` (le niveau de preuve équivalent à `next build` pour les apps web) a
  été tenté mais est resté bloqué par une chaîne de dépendances pnpm/Expo SDK 53 non
  résolues — voir §6. `tsc`/`eslint`/tests unitaires sont donc le plafond de
  vérification réellement atteint pour `apps/courier`, plus bas que ce qui a été
  obtenu pour `apps/restaurant` (Bloc 10, qui avait un navigateur réel disponible).
  Aucun simulateur Android/iOS n'existe dans cet environnement — **aucune capture
  d'écran n'a été produite ou présentée pour ce bloc**, contrairement au Bloc 10.

## 6. Dette restante (ne devient pas un chantier séparé sans autorisation)

- **Suivi de position en arrière-plan** : docs/04 §4.5/§103 le qualifie explicitement
  de point le plus fragile du projet (tueurs de tâches OEM Xiaomi/Transsion,
  foreground service Android, permission "Always" iOS). Seul le suivi au
  **premier plan** (app ouverte, `expo-location.watchPositionAsync`) est implémenté —
  `expo-task-manager` + foreground service ne le sont pas : ils exigent une
  configuration native et un appareil/émulateur réel pour être vérifiés, qu'aucun des
  deux n'était disponible ici (voir `lib/location.ts` pour le raisonnement complet).
- **Notifications push** (offre entrante app fermée/arrière-plan) : non câblées
  (`expo-notifications`/`PushPort` existent déjà côté architecture mais aucun
  provider réel n'est branché, même dette que documentée pour le reste du projet).
  Le temps réel au premier plan (room `courier:{id}`) couvre le cas app ouverte.
- **Son sur l'offre entrante** : non implémenté (contrairement au Bloc 10 qui a un
  son synthétisé Web Audio) — React Native nécessiterait `expo-av`/`expo-audio`,
  non ajouté pour rester au plus près du périmètre déjà large de ce bloc.
- **Photo de preuve de livraison** : jamais supportée côté backend non plus (seul
  `proofCode` existe sur `ConfirmDeliveredSchema`) — pas une régression de ce bloc,
  une caractéristique déjà existante de l'architecture (`ObjectStoragePort` reste un
  placeholder Bloc 0).
- **File d'actions offline** (docs/04 §4.8) : les mutations (accepter/pickup/livrer)
  échouent simplement si le réseau est coupé au moment de l'appel — aucune file de
  reprise avec confirmation à la reconnexion.
- **`expo export`** : bloqué par des dépendances manquantes entre Expo SDK 53 et le
  hoisting strict de pnpm (`@expo/metro-runtime`, `@babel/runtime`, `whatwg-fetch`,
  `@react-navigation/native` ont dû être ajoutées une à une ; `expo-modules-core`
  reste manquant). Confirmé comme un défaut **hérité**, pas introduit par ce bloc :
  `apps/mobile` (Bloc 0) a exactement le même manque et n'a jamais eu son propre
  export exercé (son script `build` est un `echo` volontaire). Poursuivre cette
  chasse aurait transformé le bloc en investigation de tooling sans fin — arrêté
  délibérément après 4 correctifs légitimes, conformément à la consigne de ne pas
  passer des heures sur ce type d'investigation.
- **Validation E2E réelle** (HTTP + PostgreSQL) : toujours bloquée par l'absence de
  Docker — inchangé depuis BUG-10.1.x/Bloc 10.
