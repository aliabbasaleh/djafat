---
id: FEAT-004
title: Se déconnecter révoque vraiment la session côté serveur
status: ready
type: bugfix
ui: no
---

<!--
Transcrit le 2026-11-06 : constat de l'analyse authentification de la session
(« le site client ne déconnecte pas vraiment : clearSession() vide le navigateur
sans appeler POST /auth/logout »), proposé à l'utilisateur comme tâche sans
décision produit (« vraie déconnexion dans les 3 applications »), lancé sur son
« continue ». L'analyse a montré que les 5 applications sont concernées.
-->

# FEAT-004 — Se déconnecter révoque vraiment la session côté serveur

## Objectif utilisateur

Quand un client, un restaurateur, un livreur ou un admin appuie sur
« Déconnexion », sa session doit être réellement fermée côté serveur. Sur un
téléphone partagé, perdu ou volé, quelqu'un qui récupère les jetons ne doit plus
pouvoir les utiliser.

## Comportement attendu

Le bouton « Déconnexion » appelle `POST /v1/auth/logout`, qui révoque la session,
puis efface la session locale. Si le jeton d'accès a expiré, l'application
rafraîchit une fois puis révoque. Si le réseau est coupé, la session locale est
quand même effacée : l'utilisateur est déconnecté sur l'appareil, et la
révocation serveur n'a pas pu se faire.

## Périmètre et exclusions

- Dans le périmètre : les boutons « Déconnexion » existants de `apps/web`,
  `apps/admin`, `apps/restaurant` et `apps/courier`, plus la déconnexion du
  contexte d'authentification de `apps/mobile` (déjà appelée quand la session
  expire). Le tout passe par `@djafat/sdk`.
- Hors périmètre : un bouton « Déconnexion » dans l'app mobile client (aucun
  n'existe, c'est un changement d'écran qui demande une référence visuelle) ;
  « Me déconnecter de tous mes appareils » (`logout-all`) ; le stockage en cookie
  `HttpOnly` du site client.

## Critères d'acceptation

- **FEAT-004-AC01** — Une déconnexion appelle `POST /v1/auth/logout` avec le jeton d'accès de la session, avant d'effacer la session locale.
- **FEAT-004-AC02** — Si le jeton d'accès a expiré, l'application rafraîchit une fois avec le jeton de rafraîchissement, puis révoque la nouvelle session.
- **FEAT-004-AC03** — La session locale est toujours effacée, même si le serveur est injoignable ou refuse la requête. La déconnexion ne lève jamais d'erreur vers l'écran.
- **FEAT-004-AC04** — Les boutons « Déconnexion » de web, admin, restaurant et livreur, ainsi que la déconnexion du contexte mobile, utilisent tous ce même comportement.

## Dépendances et contraintes

- Endpoint existant `POST /v1/auth/logout` (`@RequireAuth`, révoque `actor.sessionId`, audité `AUTH_LOGOUT`) et `POST /v1/auth/refresh`.
- Les applications ne parlent au backend que par `@djafat/sdk` (règle d'architecture).
- Aucune modification du backend.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — aucun écran ne change (boutons existants, comportement seulement).
