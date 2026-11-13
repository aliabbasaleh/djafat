# Démonstration de bout en bout (2026-11-06)

Preuve **manuelle** (non versionnée en test automatique), rejouable en suivant la
procédure ci-dessous. L'API compilée (`node dist/main.js`) tourne sur PostgreSQL 16

- PostGIS et Redis 7 locaux, avec la passerelle `infra/mock-sms`. Les numéros
  sont **fictifs** : aucun SMS réel n'a été envoyé.

## Refus de démarrer en production sans SMS réel (FEAT-006)

`NODE_ENV=production SMS_PROVIDER=mock node dist/main.js` → sortie en code 1 :

```
Invalid environment:
  - SMS_PROVIDER: "mock" is not allowed in production — no SMS would be sent and nobody could log in. Configure SMS_PROVIDER=http and SMS_HTTP_URL.
```

## Connexion et déconnexion réelles (FEAT-004, FEAT-005, FEAT-006)

Configuration : `SMS_PROVIDER=http`, `SMS_HTTP_URL=http://127.0.0.1:4020/send`.

| Étape                                    | Airtel fictif, saisi `66 00 00 99`                                                                 | Tigo fictif, saisi `٩٩ ٠٠ ٠٠ ٦٦` (clavier arabe)  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `POST /auth/otp/request`                 | 202                                                                                                | 202                                               |
| SMS reçu par la passerelle               | `to: +23566000099`, `DJAFAT : votre code est 192367. Valable 5 min. Ne le communiquez a personne.` | `to: +23599000066`, `… code est 371738 …`         |
| `POST /auth/otp/verify`                  | saisi `+23566000099` → compte `+23566000099`                                                       | saisi `00235 99 00 00 66` → compte `+23599000066` |
| `GET /me` avec le jeton                  | 200                                                                                                | 200                                               |
| `POST /auth/logout`                      | 204                                                                                                | 204                                               |
| `POST /auth/refresh` avec l'ancien jeton | **401** : session révoquée côté serveur                                                            | **401**                                           |

## Passerelle coupée

- **Premier passage** : 503 avec `{"code":"INTERNAL",…}`. **Bug trouvé** : `OTP_DELIVERY_FAILED` ne faisait pas partie
  du vocabulaire fermé `API_ERROR_CODES`, et le filtre le remplaçait par `INTERNAL`. Un test de
  non-régression passe désormais par le vrai `AllExceptionsFilter`.
- **Après correction** : 503 `{"code":"OTP_DELIVERY_FAILED","message":"Impossible d'envoyer le SMS, réessayez dans un instant."}`.
- **Journaux** : `OTP SMS attempt 1/2 for ********0098 failed: gateway unreachable`, puis `2/2`. Numéro masqué, code absent.
