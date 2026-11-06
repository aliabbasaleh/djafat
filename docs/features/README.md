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

| Feature                                                       | Statut                          |
| ------------------------------------------------------------- | ------------------------------- |
| [FEAT-001](FEAT-001-restaurant-closed-order-guard/feature.md) | done — validation rétrospective |
