# FEAT-004 — Avancement

| Étape                   | Statut | Date       | Notes                                                                                                             |
| ----------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait   | 2026-11-06 | Les 5 apps, et pas seulement le web, effacent la session sans la révoquer. L'app mobile client n'a pas de bouton. |
| Specs                   | fait   | 2026-11-06 | SPEC-004-01 (SDK), SPEC-004-02 (branchement des apps).                                                            |
| Grill-me                | fait   | 2026-11-06 | 3 hypothèses techniques ; 2 questions produit hors périmètre (bouton mobile, « tous mes appareils »).             |
| Brief                   | fait   | 2026-11-06 | Épingle SPEC-004-01@1, SPEC-004-02@1.                                                                             |
| Tests dérivés des specs | fait   | 2026-11-06 | 9 tests écrits avant le code, constatés rouges (7 SDK, 2 restaurant), puis verts.                                 |
| Implémentation          | fait   | 2026-11-06 | `api.auth.signOut`, `getRefreshToken`, `lib/session.ts`, 5 points de branchement.                                 |
| Revue qualité           | fait   | 2026-11-06 | 0 bloquant, 1 majeur suivi (preuve de bout en bout), 1 mineur (déconnexion livreur sur 401).                      |
| PR                      | fait   | 2026-11-06 | `pr.md`.                                                                                                          |

## Bloquants

- Aucun pour cette feature. FEAT-004-Q03 (bouton mobile) et Q04 (« tous mes appareils ») attendent l'utilisateur.

## Dernière vérification

`verification.md`.
