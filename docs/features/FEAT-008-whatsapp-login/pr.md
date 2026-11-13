# FEAT-008 — Se connecter avec un code reçu sur WhatsApp, sans frais de SMS

## Objectif

Lancer DJAFAT sans payer de SMS. Le client envoie « Code DJAFAT » au WhatsApp de
DJAFAT ; DJAFAT lui répond avec un code de connexion. Cette réponse est gratuite
(message de service). Le SMS peut être coupé, et une liste des méthodes de
connexion réserve la place pour Facebook, Apple et Google.

## Avant / après

| Avant                                                           | Après                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Connexion par téléphone = SMS payant, obligatoire en production | WhatsApp gratuit ; SMS désactivable (`SMS_PROVIDER=disabled`)                                      |
| L'app ne sait pas quelles méthodes sont actives                 | `GET /v1/auth/methods` (WhatsApp, SMS, e-mail, avec le lien `wa.me`)                               |
| —                                                               | Webhook Meta signé `GET/POST /v1/auth/whatsapp/webhook`, connexion `POST /v1/auth/whatsapp/verify` |

## Specs et critères couverts

SPEC-008-01@2, SPEC-008-02@2, SPEC-008-03@1, SPEC-008-04@1 — FEAT-008-AC01 à AC07.
Matrice complète dans `review.md`.

## Architecture

- Un 3ᵉ canal dans `OtpService` : hachage, expiration, essais, verrou et quotas sont les mêmes pour tous les canaux.
- Un 3ᵉ transport derrière `OtpDeliveryPort` (`cloud` ou `mock`), choisi par la configuration.
- Migration `0031_whatsapp_otp` : contrainte `channel` seulement, sans perte de données. Retour arrière documenté dans la migration.
- Aucun changement au graphe des modules.

## Vérifications exécutées

Voir `verification.md` (`verify --full` au commit courant) et `e2e-demo.md`
(API réelle, Postgres, Redis, signature HMAC comme Meta).

## Défauts trouvés et corrigés en cours de route

- Le SMS coupé consommait le quota partagé avec WhatsApp, ce qui permettait de bloquer la connexion WhatsApp d'un tiers. Trouvé par la démo, corrigé, scénario ajouté (SC05).
- Q03 contredisait FEAT-005 : seuls les numéros tchadiens étaient acceptés. La règle accepte maintenant les numéros internationaux valides, pour la diaspora.

## Risques et limites

- Il faut confirmer avec Meta que le code peut partir en message libre pendant la fenêtre de service. Sinon, on bascule sur un modèle « authentification » payant, via le même port.
- Il faut un compte Meta Business, une app Meta et un numéro dédié. Jusque-là, le faux WhatsApp sert en développement.
- Pas encore d'écrans dans les apps : il manque les maquettes.

## Échecs préexistants

Compilation Expo de mobile et coursier (`[old ]` dans `verification.md`).

## `test:int` : rouge, mais identique à l'état sans FEAT-008

`verify` classe `test:int` en « nouvel échec », parce qu'aucune référence ne
le connaît. Il échoue pourtant **à l'identique** sans FEAT-008. Comparaison
faite le 2026-11-07, avec la même base remise à neuf (migrations + données de
démarrage) avant chaque passage :

| Arbre                     | Fichiers en échec | Tests                                   |
| ------------------------- | ----------------- | --------------------------------------- |
| `50d6f23` (sans FEAT-008) | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |
| FEAT-008                  | 8/8               | 9 en échec, 40 réussis, 44 non exécutés |

La liste des échecs est la même ligne à ligne (`diff` vide). La cause est la
même qu'en CI : le limiteur de demandes OTP est partagé entre les suites
(429), et des assertions sont périmées. Je n'ajoute **pas** de référence
« test:int » : elle masquerait aussi de futures régressions. La réparation de
la suite d'intégration reste un chantier séparé.
