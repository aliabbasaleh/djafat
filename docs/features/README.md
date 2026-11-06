# Features

Une feature = un dossier `FEAT-NNN-<slug>/` écrit d'abord **à la main** :

```
FEAT-NNN-<slug>/
  feature.md          # écrit par un humain (modèle : _templates/feature.md)
  assets/             # captures de référence (actuel/attendu/inspiration) et d'exécution (exec-*)
  specs/SPEC-NNN-01.md …   # générées (/feature-specs), clarifiées (/feature-grill-me)
  clarifications.md   # questions, décisions, hypothèses
  brief.md            # brief d'exécution, épingle les versions de specs
  progress.md         # avancement, décisions, bloquants, dernière vérification
  review.md           # revue (outils puis jugement)
  verification.md     # rapport généré par scripts/pipeline/verify.mjs
  pr.md               # contenu de PR local
```

Identifiants stables, jamais réutilisés : `FEAT-001`, `FEAT-001-AC01` (critère),
`FEAT-001-VIS01` (référence visuelle), `FEAT-001-Q01` (question), `SPEC-001-01`,
`SPEC-001-01-SC01` (scénario). Un test cite le scénario qu'il couvre dans son
titre ou dans un commentaire.

Captures : nommage `assets/<ecran>-<etat>-<viewport>.png` pour les références,
`assets/exec-<spec>-<scenario>-<viewport>.png` pour les preuves d'exécution.
Chaque référence déclare sa nature et son autorité. Une capture « actuel » ou
« inspiration » n'est jamais une cible approuvée.

Validation : `pnpm check:specs`. Matrice de traçabilité :
`node scripts/pipeline/check-specs.mjs --matrix FEAT-NNN`. Processus complet :
[`docs/pipeline/README.md`](../pipeline/README.md).

| Feature                                                       | Domaine  | Statut                                                   |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| [FEAT-001](FEAT-001-restaurant-closed-order-guard/feature.md) | commande | done — validation rétrospective                          |
| [FEAT-002](FEAT-002-mock-provider-production-lock/feature.md) | paiement | done — `mock` inutilisable en production                 |
| [FEAT-003](FEAT-003-prepaid-scratch-card-topup/feature.md)    | paiement | **en pause** — brouillon, 8 questions produit en attente |
| [FEAT-004](FEAT-004-server-side-logout/feature.md)            | auth     | done — déconnexion révoquée côté serveur                 |
| [FEAT-005](FEAT-005-chad-friendly-phone-input/feature.md)     | auth     | done — numéros saisis à la tchadienne                    |

## Paiement — en pause (2026-11-06)

État figé à la demande de l'utilisateur (« finir la partie paiement, la mettre en
attente, continuer l'authentification ») :

- **Utilisable en production** : `cash` (paiement à la livraison). `mock` est verrouillé (FEAT-002).
- **En attente de décisions** : recharge par cartes à gratter (FEAT-003, 8 questions
  produit et une validation juridique CEMAC).
- **En attente d'accès externe** : Airtel Money / Tigo Cash (contrat et clés d'API ; le seed historique nomme encore `moov_money`, à confirmer),
  virement bancaire (API ou relevés de la banque), « Konoom mobile » (à identifier).
- **Dette connue** : confirmation asynchrone des remboursements (D-17), rapprochement
  automatique des relevés PSP (D-18), expiration d'une commande `placed` non confirmée.

Pour reprendre : `/feature-resume FEAT-003` une fois les réponses connues.
