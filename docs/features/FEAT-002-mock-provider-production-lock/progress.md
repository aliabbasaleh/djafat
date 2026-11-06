# FEAT-002 — Avancement

| Étape                   | Statut | Date       | Notes                                                                                                                              |
| ----------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait   | 2026-11-06 | Demande transcrite (« oui verrouille le mock »). Risque supplémentaire trouvé : le secret du webhook mock est public dans le code. |
| Specs                   | fait   | 2026-11-06 | SPEC-002-01 (registre), SPEC-002-02 (seed, v2 après exécution réelle).                                                             |
| Grill-me                | fait   | 2026-11-06 | Q01 tranchée par l'utilisateur (aucun interrupteur en production) ; Q02 et Q03 sont des hypothèses techniques.                     |
| Brief                   | fait   | 2026-11-06 | Épingle SPEC-002-01@1, SPEC-002-02@2.                                                                                              |
| Tests dérivés des specs | fait   | 2026-11-06 | Écrits avant le code et constatés en échec, puis verts. SC04 de SPEC-002-02 ajouté en v2, lui aussi en échec d'abord.              |
| Implémentation          | fait   | 2026-11-06 | Capacité `sandboxOnly`, helper pur, factory du registre, seed.                                                                     |
| Revue qualité           | fait   | 2026-11-06 | `review.md` : 0 bloquant, 1 majeur suivi (test d'intégration du câblage).                                                          |
| PR                      | fait   | 2026-11-06 | `pr.md`. Poussé sur la branche de la PR #1 (seule branche de travail autorisée).                                                   |

## Décisions

- Aucun interrupteur de production pour `mock` (FEAT-002-Q01, utilisateur).
- Spec SPEC-002-02 passée en v2 après exécution réelle : la v1 ne couvrait pas
  le re-seed d'une base dev en production.

## Bloquants

- Aucun.

## Dernière vérification

`verification.md` (généré par `scripts/pipeline/verify.mjs`, avec son commit).

## Reste à faire

- Test d'intégration HTTP du verrou (revue #2), avec la réparation de la suite d'intégration.
