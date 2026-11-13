---
id: FEAT-018
title: Repères, point appris des livraisons et note vocale
status: ready
type: new
ui: yes
---

<!--
Demande de l'utilisateur (2026-11-09) : coder les idées de l'analyse
« géolocalisation par repères et notes vocales » pas encore prises en compte.
-->

# FEAT-018 — Repères, point appris des livraisons et note vocale

## Objectif utilisateur

À N'Djamena on ne donne pas un numéro de rue, on dit « derrière la Grande
Mosquée, le portail bleu ». Le client place son adresse par rapport à un
repère connu, ajoute une indication pour le portail et, s'il veut, une note
vocale de 10 secondes. Chaque livraison réussie apprend le vrai point de la
porte, à partir du GPS du livreur : les livraisons suivantes vont droit au
bon endroit.

## Comportement attendu

- Une liste de repères de la ville (mosquées, marchés, ronds-points,
  hôpitaux…) que le client cherche par nom.
- Une adresse peut pointer vers un repère avec une position (derrière,
  devant, à côté de, en face de, près de) et une indication de portail ; sans
  épingle, le point de départ est le repère lui-même.
- Le bouton « Utiliser ma position » enregistre le GPS avec sa précision.
- Une note vocale de 10 s au plus (40 Ko) par adresse, que seul le livreur de
  la commande en cours peut écouter.
- À la livraison confirmée (code donné à la porte), la position récente et
  précise du livreur affine le point de l'adresse ; les positions imprécises
  ou trop éloignées sont ignorées.
- Les commandes suivantes envoient le livreur au point appris.

## Périmètre et exclusions

- Dans le périmètre : repères, adresse par repère, indication de portail, GPS
  avec précision, point appris, note vocale, affichage livreur.
- Hors périmètre : stockage objet des notes (gardées en base à cette taille) ;
  saisie des repères par l'équipe (graine de démonstration aux positions
  approximatives, à vérifier sur le terrain).

## Critères d'acceptation

- **FEAT-018-AC01** — Le client trouve un repère par son nom (accents et majuscules ignorés) et place son adresse par rapport à lui, avec une indication de portail ; le livreur lit une phrase claire (« Derrière Grande Mosquée — portail bleu »).
- **FEAT-018-AC02** — À la livraison confirmée, une position précise (≤ 50 m) et récente (≤ 2 min) du livreur affine le point de l'adresse ; une position imprécise ou à plus de 300 m du point connu est ignorée.
- **FEAT-018-AC03** — La commande suivante vers cette adresse envoie le livreur au point appris ; une commande passée n'est jamais modifiée.
- **FEAT-018-AC04** — Une note vocale de 10 s et 40 Ko au plus est enregistrée pour l'adresse ; seul le livreur qui livre la commande peut l'écouter.
- **FEAT-018-AC05** — Le site permet de choisir le repère, la position, l'indication, le GPS et la note vocale ; l'application livreur affiche l'indication et fait écouter la note.

## Dépendances et contraintes

- `orders` lit `addresses` uniquement à la création de la commande (règle
  existante) ; le point appris arrive par l'événement `delivery.dropoff_fix`.
- `deliveries` ne connaît pas `addresses` : la note passe par `OrderAmountPort`.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Source                      | Objet              | Nature | Écran / route / état        | Viewport         | Annotations               | Critères      | Autorité   |
| -------------- | --------------------------- | ------------------ | ------ | --------------------------- | ---------------- | ------------------------- | ------------- | ---------- |
| FEAT-018-VIS01 | assets/address-landmark.png | adresse par repère | actuel | apps/web `/adresses`, ajout | 390×844 (mobile) | capture après réalisation | FEAT-018-AC05 | contextuel |
