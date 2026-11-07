---
id: FEAT-009
title: Payer par Airtel Money ou Tigo Cash sans API, vérifié par le numéro de transaction
status: ready
type: new
ui: no
---

<!--
Transcription des décisions de l'utilisateur dans la conversation du
2026-11-07, validées par « oui » :
- « comment les gens vont payer alors qu'on n'a pas d'API… le client nous
  envoie l'argent par Airtel Money et nous on valide, mais c'est très manuel » ;
- plan retenu : paiement au numéro marchand DJAFAT, rapproché par le NUMÉRO
  DE TRANSACTION (unique), montant et numéro payeur ; validation manuelle dans
  l'admin d'abord, automatisation plus tard (lecture des SMS, puis API) ;
- « les clients paient en avance… on vérifie le montant » : paiement
  d'avance, le restaurant ne cuisine qu'après vérification ;
- une capture d'écran n'est jamais une preuve : seul ce que DJAFAT a
  réellement reçu compte.
Défaut bloquant trouvé pendant l'étude (voir clarifications Q01) : une commande
payée en espèces ne quitte jamais « en attente de paiement » et expire ; le
paiement à la livraison ne fonctionne donc pas. Corrigé ici (AC01, AC02).
-->

# FEAT-009 — Payer par Airtel Money ou Tigo Cash sans API, vérifié par le numéro de transaction

## Objectif utilisateur

Un client de N'Djamena paie sa commande avec Airtel Money ou Tigo Cash, au
numéro marchand de DJAFAT, sans que DJAFAT ait besoin d'une API opérateur.
L'équipe DJAFAT valide chaque paiement de façon sûre et rapide, sans jamais se
fier à une capture d'écran. Le paiement en espèces à la livraison fonctionne
réellement.

## Comportement attendu

- Espèces : la commande part au restaurant dès qu'elle est passée ; l'argent est
  encaissé par le livreur à la livraison.
- Airtel Money / Tigo Cash (paiement d'avance) : l'app affiche « Envoyez
  12 000 FCFA au 60 00 00 10 (DJAFAT) ». Le client paie, puis indique le numéro
  de transaction reçu par SMS (inutile s'il a payé depuis son propre numéro).
- Chaque transfert reçu sur le téléphone marchand est enregistré dans l'admin
  (numéro de transaction, montant, numéro payeur, heure).
- Dès qu'un transfert enregistré correspond, le paiement est validé, le grand
  livre est passé une seule fois et la commande part au restaurant.
- En cas de doute (montant différent, plusieurs candidats, rien reçu), rien n'est
  validé automatiquement : un opérateur tranche depuis la liste des transferts
  non rapprochés.

## Périmètre et exclusions

- Dans le périmètre : correction du paiement à la livraison (espèces), moyens de
  paiement Airtel Money et Tigo Cash au numéro marchand, enregistrement des
  transferts reçus, rapprochement automatique et manuel.
- Hors périmètre : paiement Airtel/Tigo au moment de la livraison et contrôle des
  espèces des livreurs (feature à venir « contrôle des espèces des livreurs », car les écritures du grand livre diffèrent) ;
  lecture automatique des SMS du téléphone marchand ; API opérateur ;
  remboursements Airtel/Tigo (faits à la main hors système pour l'instant) ;
  paiement en plusieurs transferts ; écrans.

## Critères d'acceptation

- **FEAT-009-AC01** — Un paiement « à la livraison » (espèces) fait passer la commande de « en attente de paiement » à « passée » immédiatement : le restaurant peut la confirmer. Le paiement reste en attente jusqu'à la livraison, comme avant.
- **FEAT-009-AC02** — La part du livreur reste correctement comptabilisée : une commande passée pour paiement à la livraison n'est pas traitée comme prépayée, et une commande prépayée l'est toujours.
- **FEAT-009-AC03** — Airtel Money et Tigo Cash ne sont proposés que si le numéro marchand DJAFAT de l'opérateur est configuré ; créer un tel paiement renvoie les instructions (montant, numéro marchand) et laisse la commande en attente de paiement.
- **FEAT-009-AC04** — Un opérateur DJAFAT (finance, support, admin) enregistre chaque transfert reçu : opérateur, numéro de transaction, montant, numéro payeur, heure. Un même numéro de transaction ne peut pas être enregistré deux fois pour un opérateur.
- **FEAT-009-AC05** — Le paiement n'est validé que si un transfert enregistré correspond : même opérateur, même montant et même devise, non utilisé, reçu après la création du paiement ; soit par le numéro de transaction donné par le client, soit, sans numéro, par un unique transfert du numéro payeur du client. La commande passe alors au restaurant.
- **FEAT-009-AC06** — Un transfert ne sert qu'à un seul paiement, garanti par la base de données ; une validation passe le grand livre exactement une fois, même si le rapprochement est tenté plusieurs fois ou en même temps.
- **FEAT-009-AC07** — Au moindre doute (montant différent, plusieurs candidats, transfert pas encore enregistré, paiement plus en attente), rien n'est validé automatiquement ; un opérateur voit la liste des transferts non rapprochés et peut rapprocher à la main un transfert d'un paiement, avec les mêmes contrôles.

## Dépendances et contraintes

- Règles non négociables (README) : `Money` en `bigint` ; seul `ledger` écrit le
  grand livre (via `markSucceeded`) ; `orders` n'importe jamais `payments`
  (événements) ; idempotence garantie par PostgreSQL (contraintes d'unicité) ;
  registre `PaymentProvider` sans `if (provider === …)` ; aucun secret dans Git.
- Réutiliser `markSucceeded` (grand livre + outbox + événement), le registre, les
  rôles et permissions existants.
- Accès externe à obtenir par l'utilisateur : compte marchand Airtel Money et
  Tigo Cash, téléphone marchand dédié.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement (les écrans de l'admin et de l'app viendront avec leurs maquettes).
