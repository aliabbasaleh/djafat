# FEAT-006 — Avancement

| Étape          | Statut | Date       | Notes                                                                              |
| -------------- | ------ | ---------- | ---------------------------------------------------------------------------------- |
| Intake → Brief | fait   | 2026-11-06 | Le seul fournisseur branché (mock) n'envoie rien en production.                    |
| Tests          | fait   | 2026-11-06 | Rouges d'abord ; serveur HTTP réel local.                                          |
| Implémentation | fait   | 2026-11-06 | Adaptateur HTTP, texte SMS, choix par configuration, refus en production.          |
| Démonstration  | fait   | 2026-11-06 | `e2e-demo.md` : numéros Airtel et Tigo fictifs ; bug `INTERNAL` trouvé et corrigé. |
| Revue / PR     | fait   | 2026-11-06 | 0 bloquant.                                                                        |

## Bloquant pour la production

Choix du fournisseur SMS réel (FEAT-006-Q01) : sans lui, l'API refuse désormais de démarrer en production, ce qui est voulu.
