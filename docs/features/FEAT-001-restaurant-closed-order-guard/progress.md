# FEAT-001 — Avancement

**Validation rétrospective du pipeline** (2026-11-06) : le comportement est livré
depuis le commit `cc3b207`. Chaque étape ci-dessous a été rejouée sur des
artefacts réels, pour éprouver le pipeline sans rien inventer.

| Étape                   | Statut | Date       | Notes                                                                                                                                                           |
| ----------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake                  | fait   | 2026-11-06 | Feature transcrite depuis `cc3b207` et docs/36 §6.1 ; `ui: no`, donc aucune capture requise. Code localisé : `orders.service.ts:240`, `catalog.service.ts:209`. |
| Specs                   | fait   | 2026-11-06 | 2 specs : SPEC-001-01 (garde à la commande, AC01–AC04), SPEC-001-02 (source unique de disponibilité, AC05).                                                     |
| Grill-me                | fait   | 2026-11-06 | 4 questions : Q01 et Q02 tranchées (décisions du commit), Q03 hypothèse technique, Q04 ouverte et hors périmètre.                                               |
| Brief                   | fait   | 2026-11-06 | Épingle SPEC-001-01@1 et SPEC-001-02@1.                                                                                                                         |
| Tests dérivés des specs | fait   | 2026-11-06 | Tests existants liés aux scénarios par commentaire (aucune assertion modifiée). Reproduction : sans la garde, 5 tests échouent (SC01–SC04).                     |
| Implémentation          | fait   | 2026-10-14 | Commit `cc3b207` (antérieur au pipeline).                                                                                                                       |
| Revue qualité           | fait   | 2026-11-06 | `review.md` : 0 bloquant, 1 majeur (test d'intégration manquant, suivi), 1 mineur, 3 notes.                                                                     |
| PR                      | fait   | 2026-11-06 | `pr.md` (exemple local, non publié : le correctif est déjà sur la branche).                                                                                     |

## Décisions

- Les tests existants sont liés par un commentaire `// SPEC-…` au-dessus de
  chaque `it`, plutôt qu'en renommant les tests : c'est la modification minimale,
  et elle ne touche à aucune assertion.

## Bloquants

- Aucun pour cette feature. FEAT-001-Q04 (expiration d'une commande `placed`)
  reste une décision produit ouverte, hors périmètre.

## Dernière vérification

Voir `verification.md` : rapport généré par
`node scripts/pipeline/verify.mjs --full --report …`, avec son commit. Ce
rapport est périmé dès qu'un fichier change ; il faut alors le relancer.

## Reste à faire

- FU-FEAT001-01 : test d'intégration `RESTAURANT_CLOSED` (revue #1).
- Revue #2 : `as never` dans `restaurant-availability.service.ts`.
