---
id: FEAT-013
title: L'app livreur dans le navigateur du téléphone
status: ready
type: new
ui: yes
---

<!--
Décision de l'utilisateur (2026-11-09) : « pour l'instant on reste seulement
sur la version web … et plus tard on attaque l'application mobile » ; « oui
juste pour le lancement et mise en ligne et teste aussi pour présenter notre
projet qui est fonctionnel aux investisseurs ».
-->

# FEAT-013 — L'app livreur dans le navigateur du téléphone

## Objectif utilisateur

Lancer DJAFAT en version web seulement : le livreur ouvre l'app livreur dans le
navigateur de son téléphone, sans rien installer, pour le pilote et pour les
démonstrations aux investisseurs.

## Comportement attendu

- La même app livreur (connexion, passage en ligne, course proposée, retrait,
  livraison avec le code) s'ouvre dans un navigateur.
- La session du livreur reste ouverte après rechargement de la page.
- La position GPS est envoyée tant que la page est ouverte (limite assumée :
  pas d'envoi écran éteint, l'app mobile le fera plus tard).

## Périmètre et exclusions

- Dans le périmètre : dépendances web d'Expo, stockage de session sur le web,
  commande de construction web, vérification réelle dans un navigateur.
- Hors périmètre : publication sur les magasins d'applications, GPS en
  arrière-plan, notifications push, hébergement (mise en ligne).

## Critères d'acceptation

- **FEAT-013-AC01** — `pnpm --filter @djafat/courier build:web` produit un site statique de l'app livreur, sans réglage temporaire ni fichier hors du dépôt.
- **FEAT-013-AC02** — Sur le web, la session est gardée dans le stockage du navigateur ; sur téléphone natif, elle reste dans le coffre sécurisé du système (inchangé).
- **FEAT-013-AC03** — Dans un navigateur, un livreur se connecte, passe en ligne, reçoit une course, l'accepte, la récupère et la livre avec le code du client.
- **FEAT-013-AC04** — La construction iOS/Android existante continue de passer.

## Dépendances et contraintes

- Le code de l'app reste unique pour le web et le mobile ; aucune règle métier
  nouvelle. Le serveur est inchangé.
- Les fronts n'atteignent le serveur que par `@djafat/sdk`.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Source                 | Objet                | Nature | Écran / route / état                  | Viewport         | Annotations               | Critères      | Autorité   |
| -------------- | ---------------------- | -------------------- | ------ | ------------------------------------- | ---------------- | ------------------------- | ------------- | ---------- |
| FEAT-013-VIS01 | assets/courier-web.png | Course proposée, web | actuel | apps/courier (web) accueil, une offre | 390×844 (mobile) | capture après réalisation | FEAT-013-AC03 | contextuel |
