# Démonstration de bout en bout (2026-11-07)

Preuve **manuelle** obtenue sur l'API compilée (`node dist/main.js`), avec
PostgreSQL 16 + PostGIS et Redis 7 locaux, et un vrai serveur SMTP de capture
(`smtp-server`, port 2525). Configuration : `EMAIL_PROVIDER=smtp`,
`SMTP_URL=smtp://127.0.0.1:2525`. Numéros et adresses **fictifs**.

## Migration 0030 sur des données existantes

Base migrée jusqu'à 0029, puis une ligne `otp_codes` (SMS) et une ligne
`phone_auth_locks` insérées, puis 0030 appliquée. Résultat :

- `otp_codes` : `+23566000099`, `channel=sms`, `purpose=login` (ligne conservée) ;
- `auth_target_locks` : `+23566000099`, `failed=2` (ligne conservée).

## Parcours

| #   | Étape                                                           | Résultat                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Connexion par SMS, Airtel fictif `+23566000099`                 | jeton obtenu                                                                                                                                                                           |
| 2   | `POST /me/email` avec `  Awa@Example.TD  `                      | 202 ; e-mail SMTP vers **`awa@example.td`**, sujet `Votre code de connexion DJAFAT`                                                                                                    |
| 3   | `POST /me/email/verify` avec le code reçu                       | adresse `awa@example.td` enregistrée                                                                                                                                                   |
| 4   | `GET /me`                                                       | `email: awa@example.td`                                                                                                                                                                |
| 5   | Déconnexion                                                     | 204                                                                                                                                                                                    |
| 6   | `POST /auth/email/request` avec une adresse inconnue            | **202**, **0 e-mail envoyé** (aucune énumération des comptes)                                                                                                                          |
| 7   | `POST /auth/email/request` avec `AWA@example.td`, puis `verify` | 1 e-mail ; connecté au compte `+23566000099` ; `GET /me` 200                                                                                                                           |
| 8   | Un autre compte (Tigo fictif) vérifie la même adresse           | **409 `EMAIL_ALREADY_USED`**                                                                                                                                                           |
| 9   | 11 essais de connexion avec un mauvais code                     | `401 ×10` puis **`423` (verrou)**. La demande de code de cette étape a d'ailleurs été refusée par la limite de 3 codes par 10 min et par adresse (2 + 7 + 8 déjà comptés), comme prévu |
| 10  | Base : codes e-mail                                             | `channel=email`, `target` en minuscules, `code_hash` = HMAC hexadécimal de 64 caractères                                                                                               |
| 11  | Journaux de l'API                                               | 0 occurrence de l'adresse complète ; `OTP email accepted by SMTP server for a***@example.td` ; aucun code                                                                              |
