---
id: FEAT-002
title: Le fournisseur de paiement mock est inutilisable en production
status: ready
type: bugfix
ui: no
---

<!--
Transcrit le 2026-11-06 depuis la demande de l'utilisateur dans la session
d'intégration du pipeline : « oui verrouille le mock ». Le constat d'origine
(analyse paiement de la même session) : MockPaymentProvider est enregistré
quel que soit l'environnement (payments.module.ts) et le seed l'active sans
vérifier NODE_ENV (prisma/seed.ts). Validé par l'utilisateur : « oui ».
-->

# FEAT-002 — Le fournisseur de paiement mock est inutilisable en production

## Objectif utilisateur

En tant que DJAFAT (ops/finance), je veux qu'aucun client ne puisse payer en
production avec le fournisseur de démonstration `mock`, qui accepte tout paiement
et dont le secret de webhook est public dans le code. Sinon, une commande peut être
« payée » sans argent réel.

## Comportement attendu

En production, `mock` n'existe pas pour l'API : il n'est pas proposé dans les
moyens de paiement, un paiement `mock` est refusé, et un webhook `mock` est
rejeté. Même une ligne de configuration en base qui l'activerait par erreur reste
sans effet. En développement et en CI, rien ne change : le pilote et les tests
continuent d'utiliser `mock`.

## Périmètre et exclusions

- Dans le périmètre : enregistrement des fournisseurs dans l'API, seed de la base.
- Hors périmètre : nettoyage d'une base de production déjà seedée (aucune n'existe
  à ce jour) ; nouveaux fournisseurs réels (Airtel Money, recharge par code : FEAT
  à venir) ; rotation du secret de webhook du mock (il n'existe que hors production).

## Critères d'acceptation

- **FEAT-002-AC01** — En production, créer un paiement avec `providerCode: "mock"` est refusé avec le code `PROVIDER_UNAVAILABLE`, et aucun paiement n'est écrit.
- **FEAT-002-AC02** — En production, un webhook adressé au fournisseur `mock` est refusé avec `PROVIDER_UNAVAILABLE`, même correctement signé avec le secret de développement.
- **FEAT-002-AC03** — En production, la liste des moyens de paiement disponibles ne contient jamais `mock`, même si la base l'active.
- **FEAT-002-AC04** — Hors production (développement, test), `mock` reste disponible et fonctionnel comme aujourd'hui.
- **FEAT-002-AC05** — Le seed exécuté avec `NODE_ENV=production` n'active pas `mock` : fournisseur inactif, aucune configuration de disponibilité, drapeau `mock_payment_provider` désactivé.

## Dépendances et contraintes

- Règle du README : aucun `if (provider === 'mock')`. Le verrou doit être piloté
  par les données (capacité déclarée par le fournisseur), via le registre.
- Module `payments` (DAG inchangé) ; contrat `ProviderCapabilities` dans `@djafat/types`.
- `cash` doit rester disponible en production.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — feature backend uniquement.
