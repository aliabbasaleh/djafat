---
id: FEAT-010
title: Plafonner les espèces détenues par un livreur et encaisser ses reversements Airtel
status: ready
type: new
ui: no
---

<!--
Transcription des décisions de l'utilisateur (conversation du 2026-11-07,
« continue » le même jour) :
- crainte « de fraude de livreur… bizarre qu'un indépendant récupère l'argent
  pour toi » ;
- plan validé : plafond d'espèces par livreur (exemple 30 000 FCFA), au-delà
  plus aucune commande jusqu'au reversement ; reversement par Airtel Money,
  validé automatiquement grâce aux transferts enregistrés (FEAT-009) ; caution,
  pièce d'identité et garant à l'inscription ; code de livraison.
Arbitrage de périmètre (clarifications Q01, Q02) : le code de livraison existe
déjà ; caution et garant sont des formalités hors système ; Airtel payé à la
porte est une feature à part.
-->

# FEAT-010 — Plafonner les espèces détenues par un livreur et encaisser ses reversements Airtel

## Objectif utilisateur

DJAFAT (ops, finance) limite le risque qu'un livreur indépendant garde l'argent
des commandes payées en espèces : un livreur ne peut jamais détenir plus qu'un
plafond, et il reverse facilement par Airtel Money pour pouvoir continuer à
travailler.

## Comportement attendu

- Chaque livraison payée en espèces augmente l'argent détenu par le livreur, tel
  que le grand livre le connaît déjà.
- Dès que cet argent atteint le plafond (30 000 FCFA par défaut, réglable), le
  livreur ne reçoit plus de nouvelle commande.
- Il envoie l'argent au numéro marchand DJAFAT par Airtel Money. L'équipe voit ce
  transfert dans la liste des transferts reçus et l'affecte au livreur. Son argent
  détenu baisse, et s'il repasse sous le plafond il reçoit de nouveau des commandes.
- Le livreur voit ce qu'il détient, le plafond, et s'il est bloqué ; l'équipe voit
  la même chose pour chaque livreur.

## Périmètre et exclusions

- Dans le périmètre : calcul de l'argent détenu depuis le grand livre, plafond
  réglable, blocage et déblocage automatiques pour la répartition des commandes
  (API et worker), affectation d'un transfert reçu au reversement d'un livreur,
  consultation.
- Hors périmètre : paiement Airtel/Tigo à la porte du client (feature à venir) ;
  caution, pièce d'identité et garant (formalités d'inscription hors système) ;
  reversement en espèces au bureau ; écrans.

## Critères d'acceptation

- **FEAT-010-AC01** — L'argent détenu par un livreur est le solde de son compte `CASH_FLOAT` dans le grand livre, jamais un compteur à part.
- **FEAT-010-AC02** — Quand l'argent détenu atteint le plafond (réglage `courier_cash_ceiling_minor`, 30 000 XAF par défaut), le livreur est bloqué : il n'est plus proposé pour aucune nouvelle livraison, que la répartition se fasse dans l'API ou dans le worker.
- **FEAT-010-AC03** — L'équipe (finance, support, admin) affecte un transfert reçu non rapproché au reversement d'un livreur : en une seule transaction, le transfert est marqué utilisé et le grand livre enregistre le reversement (`cash_reconciliation`). Un transfert ne sert qu'une fois, et un reversement supérieur à l'argent détenu est refusé.
- **FEAT-010-AC04** — Après un reversement, le blocage est réévalué : un livreur repassé sous le plafond reçoit de nouveau des commandes.
- **FEAT-010-AC05** — Le livreur consulte l'argent qu'il détient, le plafond et son état (bloqué ou non) ; l'équipe consulte la même chose pour n'importe quel livreur.

## Dépendances et contraintes

- Règles non négociables : `bigint` ; seul `ledger` écrit le grand livre ; DAG
  (`deliveries` peut lire `ledger` et piloter `couriers` ; `payments` peut écrire
  par `ledger`) ; idempotence PostgreSQL (une clé par reversement).
- Réutiliser `CASH_FLOAT`, le type de groupe `cash_reconciliation`, la table
  `mobile_money_receipts` et ses routes (FEAT-009), les réglages de plateforme.
- La répartition des livraisons existe en deux copies (API et worker) : les deux
  doivent appliquer le blocage.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement.
