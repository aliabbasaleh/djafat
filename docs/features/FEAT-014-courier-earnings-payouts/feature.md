---
id: FEAT-014
title: Gains, historique et retraits du livreur
status: ready
type: new
ui: yes
---

<!--
Demande de l'utilisateur (2026-11-09) : « qu'ils peuvent aussi voir leurs
montants gagnés s'ils veulent retirer … historique … strictement comme la
fonctionnalité de Deliveroo ». Choix validés le même jour : versement
automatique chaque lundi pour la semaine précédente ; retrait à la demande à
partir de 2 000 FCFA ; frais Airtel payés par DJAFAT pour le versement
automatique, par le livreur pour un retrait à la demande. Le livreur ne voit
jamais le montant des commandes, seulement ses gains.
-->

# FEAT-014 — Gains, historique et retraits du livreur

## Objectif utilisateur

Comme sur Deliveroo, le livreur voit ce qu'il gagne (aujourd'hui, cette
semaine, course par course) et reçoit son argent sur son Airtel Money : chaque
lundi automatiquement, ou plus tôt s'il le demande.

## Comportement attendu

- « Mes gains » : gagné cette semaine et aujourd'hui (montant, nombre de
  courses), historique des courses livrées (date, restaurant, quartier, gain),
  et le compte : disponible, espèces encaissées à reverser, net à recevoir.
- Bouton « Retirer maintenant » : demande le net, à partir de 2 000 FCFA ; les
  frais Airtel sont à sa charge. Une seule demande ouverte à la fois.
- Chaque lundi, DJAFAT prépare le versement de chaque livreur dont le net est
  positif ; frais à la charge de DJAFAT.
- L'équipe voit les versements à envoyer, envoie par Airtel Money au numéro du
  livreur, saisit le numéro de transaction et les frais ; le livreur voit son
  versement « envoyé » avec ce numéro.
- Le versement solde d'abord les espèces que le livreur doit, puis paie le
  reste : il ne peut jamais garder des espèces et retirer ses gains.

## Périmètre et exclusions

- Dans le périmètre : historique et totaux, demande de retrait, préparation
  hebdomadaire, envoi enregistré par l'équipe, écritures au grand livre.
- Hors périmètre : envoi automatique par l'API Airtel (plus tard), pourboires,
  relevés PDF.

## Critères d'acceptation

- **FEAT-014-AC01** — Le livreur voit ses gains d'aujourd'hui et de la semaine (depuis lundi 00:00, heure de N'Djamena), avec le nombre de courses, et l'historique de ses courses livrées avec le gain de chacune ; jamais le montant d'une commande.
- **FEAT-014-AC02** — Le livreur voit son disponible, ses espèces à reverser et son net à recevoir (disponible moins espèces, jamais négatif).
- **FEAT-014-AC03** — Le livreur demande un retrait du net, refusé sous 2 000 FCFA ou s'il a déjà une demande ouverte ; frais à sa charge.
- **FEAT-014-AC04** — Chaque lundi, un versement hebdomadaire est préparé pour chaque livreur au net positif sans demande ouverte, une seule fois par semaine ; frais à la charge de DJAFAT.
- **FEAT-014-AC05** — L'équipe enregistre un versement envoyé (numéro de transaction, frais Airtel) : en une transaction, les espèces dues sont soldées sur les gains puis le reste est payé, au grand livre seulement, une seule fois.
- **FEAT-014-AC06** — Le livreur voit l'historique de ses versements (demandé, envoyé, montant reçu, numéro de transaction).

## Dépendances et contraintes

- Règles non négociables : `bigint` ; seul `ledger` écrit le grand livre ;
  DAG (`deliveries` lit ses livraisons, `payments` porte les versements) ;
  idempotence PostgreSQL ; aucun secret en clair.
- Réutiliser `COURIER_AVAILABLE`, `CASH_FLOAT`, `PSP_CLEARING`,
  `PSP_FEE_EXPENSE`, les groupes `payout` et `cash_reconciliation`, la
  réévaluation du plafond d'espèces (FEAT-010).

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

| ID             | Source                      | Objet         | Nature | Écran / route / état       | Viewport         | Annotations               | Critères      | Autorité   |
| -------------- | --------------------------- | ------------- | ------ | -------------------------- | ---------------- | ------------------------- | ------------- | ---------- |
| FEAT-014-VIS01 | assets/courier-earnings.png | « Mes gains » | actuel | apps/courier « Mes gains » | 390×844 (mobile) | capture après réalisation | FEAT-014-AC01 | contextuel |
