---
id: FEAT-006
title: Les codes de connexion partent vraiment par SMS en production
status: ready
type: bugfix
ui: no
---

<!--
Demande de l'utilisateur (2026-11-06) : « en tant qu'expert, fais-le avec un
numéro Tigo ou Airtel fictif, et après, s'ils n'ont pas d'API, comment procéder ».
Constat : auth.module.ts branche toujours MockOtpDeliveryProvider, qui n'envoie
rien et, en production, ne stocke même pas le code. Personne ne peut donc se
connecter en production.
-->

# FEAT-006 — Les codes de connexion partent vraiment par SMS en production

## Objectif utilisateur

Un utilisateur qui demande un code de connexion reçoit vraiment un SMS. DJAFAT
ne peut pas, par erreur, démarrer en production sans moyen d'envoyer de SMS.

## Comportement attendu

L'API envoie le code par une passerelle SMS HTTP configurable. Ce peut être un
agrégateur, un opérateur ou une passerelle locale (Kannel, téléphone Android
passerelle). Le contrat est générique : `POST <url>` avec `{ to, from, body }`.
Si l'envoi échoue, l'utilisateur reçoit une erreur claire, réessayable. En
production, l'API refuse de démarrer si aucun vrai fournisseur n'est configuré.

## Périmètre et exclusions

- Dans le périmètre : envoi des codes OTP par HTTP, choix du fournisseur par
  configuration, refus de démarrer en production sans fournisseur réel, texte du SMS.
- Hors périmètre : SMPP direct avec un opérateur (un autre adaptateur derrière le
  même port) ; WhatsApp et appel vocal ; lecture automatique du SMS sur Android ;
  choix commercial du fournisseur.

## Critères d'acceptation

- **FEAT-006-AC01** — Avec `SMS_PROVIDER=http`, une demande de code envoie une requête HTTP à la passerelle configurée, avec le numéro E.164, l'expéditeur et un texte contenant le code.
- **FEAT-006-AC02** — Le texte du SMS est court (un seul SMS, sans accent) et contient le code, sa durée de validité et une mise en garde contre le partage du code.
- **FEAT-006-AC03** — Si la passerelle est injoignable ou répond par une erreur, l'API répond 503 `OTP_DELIVERY_FAILED`, après un seul nouvel essai pour une erreur réseau ou serveur. Le code n'apparaît jamais dans les journaux.
- **FEAT-006-AC04** — En production, l'API refuse de démarrer avec `SMS_PROVIDER=mock`, ou avec `SMS_PROVIDER=http` sans URL de passerelle.
- **FEAT-006-AC05** — En développement et en CI, `mock` reste le fournisseur par défaut (le pilote et les tests d'intégration ne changent pas).

## Dépendances et contraintes

- Port existant `OtpDeliveryPort` (`@djafat/types`) : la nouvelle classe s'y branche ; le service OTP ne change pas.
- Pas de secret dans Git : la clé de la passerelle vient de l'environnement (`SMS_HTTP_API_KEY`).
- Le serveur `infra/mock-sms` (`POST /send { to, body }`) sert de passerelle locale pour tester le vrai chemin HTTP.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement.
