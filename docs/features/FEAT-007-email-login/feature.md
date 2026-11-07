---
id: FEAT-007
title: Ajouter son e-mail et se connecter avec un code reçu par e-mail
status: ready
type: new
ui: no
---

<!--
Demandes de l'utilisateur (2026-11-06/07) : « n'oublie pas l'adresse mail », puis
« choisis tout ce qu'un pro senior ferait en prenant en compte la réalité du
Tchad et de l'Afrique ». Arbitrage CTO consigné dans clarifications.md :
l'e-mail est un identifiant SECONDAIRE et vérifié (le téléphone reste
obligatoire pour la livraison), et sert de connexion de secours gratuite quand
le SMS n'arrive pas. Envoi SMTP générique.
-->

# FEAT-007 — Ajouter son e-mail et se connecter avec un code reçu par e-mail

## Objectif utilisateur

Un client qui a déjà un compte (créé avec son téléphone) peut ajouter son adresse
e-mail et la vérifier. Ensuite, s'il ne reçoit pas le SMS, ou s'il veut éviter son
coût, il se connecte avec un code reçu par e-mail.

## Comportement attendu

- Connecté, le client saisit son e-mail. Il reçoit un code à 6 chiffres, le saisit,
  et son e-mail devient « vérifié » sur son compte.
- Déconnecté, il saisit son e-mail vérifié. Il reçoit un code et se connecte au
  même compte, exactement comme par SMS.
- Une adresse inconnue ou non vérifiée ne révèle rien : la réponse est la même,
  mais aucun e-mail n'est envoyé.
- La sécurité est celle des codes SMS : code haché, durée de validité, essais
  limités, verrou après trop d'échecs, audit.

## Périmètre et exclusions

- Dans le périmètre : ajout et vérification d'un e-mail, connexion par code e-mail,
  envoi SMTP générique, un faux envoi en développement.
- Hors périmètre : création d'un compte par e-mail seul (le téléphone reste requis),
  récupération de compte après changement de numéro, reçus par e-mail, connexion
  Google, écrans des applications.

## Critères d'acceptation

- **FEAT-007-AC01** — Un utilisateur connecté qui demande la vérification d'un e-mail reçoit un code à 6 chiffres à cette adresse (normalisée en minuscules, sans espaces).
- **FEAT-007-AC02** — Le bon code rend l'e-mail vérifié sur son compte ; un mauvais code est refusé (`OTP_INVALID`) ; une adresse déjà vérifiée par un autre compte est refusée (`EMAIL_ALREADY_USED`).
- **FEAT-007-AC03** — Une demande de connexion par e-mail répond toujours 202, mais n'envoie un code que si l'adresse est vérifiée sur un compte actif.
- **FEAT-007-AC04** — Le bon code de connexion ouvre une session (jetons d'accès et de rafraîchissement) sur ce compte ; un compte inactif est refusé (`ACCOUNT_INACTIVE`).
- **FEAT-007-AC05** — Les e-mails partent par SMTP (n'importe quel fournisseur). Un échec d'envoi renvoie 503 `OTP_DELIVERY_FAILED`. En production sans SMTP configuré, la fonctionnalité répond 503 `EMAIL_UNAVAILABLE`, sans bloquer le démarrage, puisqu'elle est optionnelle.
- **FEAT-007-AC06** — Les codes e-mail ont les mêmes protections que les codes SMS : hachage, expiration, limites d'essais et de demandes, verrou, audit.

## Dépendances et contraintes

- Réutiliser `OtpService` (une seule implémentation de la sécurité des codes), le
  limiteur de débit, l'émission de session de la connexion par SMS, et
  `users.email` / `users.email_verified_at`. L'index unique `users_email_active_uk`
  existe déjà.
- Aucune adresse ni aucun code en clair dans les journaux.

## Questions ouvertes

Voir `clarifications.md`.

## Références visuelles

N/A — backend uniquement (les écrans viendront avec leurs maquettes).
