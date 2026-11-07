# FEAT-008 — Avancement

| Étape          | Statut | Date       | Notes                                                                                  |
| -------------- | ------ | ---------- | -------------------------------------------------------------------------------------- |
| Intake         | fait   | 2026-11-07 | Transcription des décisions de l'utilisateur (« oui » au plan corrigé).                |
| Specs / brief  | fait   | 2026-11-07 | 4 specs ; faille du « reverse OTP » corrigée (Q01) avant toute ligne de code.          |
| Grill-me       | fait   | 2026-11-07 | 9 questions tranchées, aucune bloquante ouverte.                                       |
| Tests          | fait   | 2026-11-07 | Rouges d'abord ; adaptateur contre un serveur HTTP local ; Q03 révisée (FEAT-005).     |
| Implémentation | fait   | 2026-11-07 | Migration 0031, 3ᵉ canal dans `OtpService`, webhook signé, registre, SMS désactivable. |
| Démonstration  | fait   | 2026-11-07 | `e2e-demo.md` ; défaut du quota partagé trouvé et corrigé (SC05).                      |
| Revue / PR     | fait   | 2026-11-07 | 0 bloquant ouvert ; 1 risque externe (règles Meta) à confirmer.                        |

## Ce qui attend l'utilisateur

1. Compte Meta Business + app Meta + numéro dédié (puce Airtel ou Tigo).
2. Renseigner `WHATSAPP_*` en production (jeton, id du numéro, secret de l'app, jeton de vérification).
3. Déclarer l'URL du webhook dans Meta : `https://<api>/v1/auth/whatsapp/webhook`.

## Suite

Écrans de l'app (maquettes), connexion Facebook (puis Apple), commande et support par WhatsApp.
