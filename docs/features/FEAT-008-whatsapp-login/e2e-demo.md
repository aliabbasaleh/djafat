# FEAT-008 — Démonstration de bout en bout (2026-11-07)

Exécution réelle, pas de faux dans l'API :

- API compilée (`node dist/main.js`) ;
- PostgreSQL 16 + PostGIS local, migrations 0001 à 0031 appliquées, données de démarrage chargées ;
- Redis local ;
- `SMS_PROVIDER=disabled`, `WHATSAPP_PROVIDER=cloud`.

Seul l'hôte `graph.facebook.com` est remplacé, par un petit serveur HTTP local qui enregistre les messages sortants (`WHATSAPP_GRAPH_URL=http://127.0.0.1:4030/v21.0`). Les messages entrants sont signés en HMAC-SHA256, comme le fait Meta. Tous les numéros sont fictifs.

| #   | Action                                                    | Résultat observé                                                                                                           |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /v1/auth/methods`                                    | `whatsapp` disponible, lien `https://wa.me/23560000001?text=Code%20DJAFAT` ; `sms` indisponible ; `email` disponible (dev) |
| 2   | `POST /v1/auth/otp/request` (SMS coupé)                   | 503 `SMS_UNAVAILABLE`                                                                                                      |
| 3   | Vérification d'abonnement, bon jeton / mauvais jeton      | défi `987654` renvoyé / 403                                                                                                |
| 4   | Message « Code DJAFAT » avec une signature fausse         | 401, rien envoyé                                                                                                           |
| 5   | Même message correctement signé                           | 200 ; **1** message sortant vers `/v21.0/100000000000001/messages`, `to: 23566123456`, avec `Bearer`                       |
| 6   | Meta relivre le même message (même `id`)                  | 200, **aucun** second message sortant                                                                                      |
| 7   | Texte reçu par le client                                  | « Votre code DJAFAT : _305689_ / Valable 5 min. / Ne le donnez à personne, même à un livreur… »                            |
| 8   | `POST /v1/auth/whatsapp/verify` avec un mauvais code      | 401 `OTP_INVALID`                                                                                                          |
| 9   | Même route avec le bon code, numéro saisi « 66 12 34 56 » | 200, compte **créé** pour `+23566123456`, jetons émis                                                                      |
| 10  | `GET /v1/me` avec le jeton d'accès                        | 200, même compte, rôle `customer`                                                                                          |
| 11  | Le même code réutilisé                                    | 401 `OTP_INVALID` (usage unique)                                                                                           |
| 12  | Journaux de l'API (250 lignes)                            | 0 occurrence du code, du numéro complet, du jeton ou du secret ; le numéro apparaît masqué `********3456`                  |

## Défaut trouvé par cette démonstration, puis corrigé

Le SMS étant coupé, chaque demande de code SMS créait **quand même** une ligne
dans `otp_codes` (2 lignes après l'étape 2). Elle consommait aussi le quota de
demandes du numéro, partagé avec WhatsApp. Un tiers pouvait donc épuiser le
quota d'une victime avec des demandes SMS, et la victime ne recevait plus ses
codes WhatsApp.

Correction : `OtpService` refuse le SMS coupé **avant** toute limite et toute
écriture (SPEC-008-01-SC05, test d'abord rouge puis vert). Rejoué sur l'API
reconstruite : **7** demandes SMS → 7 × 503, **0** ligne dans `otp_codes`, et
le code WhatsApp du même numéro part toujours.

Services arrêtés après la démonstration.
