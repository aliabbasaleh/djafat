# Pipeline de développement agentique (Claude Code)

Intégré le 2026-11-06 au harnais **Claude Code**, en natif : `CLAUDE.md`, skills
`.claude/skills/`, sous-agent `.claude/agents/`, hooks `.claude/settings.json`.
Aucun runtime d'agent, moteur de workflow, client de modèle, mémoire ou
planificateur n'a été ajouté. Le code propre au pipeline se limite à des
vérifications, des rapports et deux petits hooks (`scripts/pipeline/`). Le
modèle n'est fixé nulle part : c'est celui de la session.

## 1. Flux

```
Feature écrite à la main (+ captures)
  → /feature-intake → /feature-specs → /feature-brief → /feature-grill-me
  → /feature-brief (versions clarifiées)
  → /feature-tests ⇄ /feature-implement   (+ /feature-visual si ui: yes)
  → /feature-review ⇄ corrections
  → /feature-pr (contenu local)
```

`/feature-pipeline` enchaîne ces étapes dans une seule session.
`/feature-resume` reprend à partir des artefacts. La découverte du problème, la
décomposition et la priorisation restent **hors** pipeline.

Chaîne de validation : feature + références visuelles → specs clarifiées →
scénarios (ID) → tests qui citent les ID → `verify`. Matrice :
`node scripts/pipeline/check-specs.mjs --matrix FEAT-NNN`. Un lien de
traçabilité ne prouve pas l'adéquation : c'est la revue qui la juge.

Artefacts et conventions : [`docs/features/README.md`](../features/README.md).
Exemple complet : [`FEAT-001`](../features/FEAT-001-restaurant-closed-order-guard/feature.md)
(validation **rétrospective** sur le correctif `cc3b207`).

## 2. Points d'entrée

| Besoin                         | Entrée                                                    |
| ------------------------------ | --------------------------------------------------------- |
| Traiter une feature            | `/feature-pipeline` (ou « traite FEAT-001 »)              |
| Valider une feature écrite     | `/feature-intake`                                         |
| Générer les specs              | `/feature-specs`                                          |
| Brief d'exécution (métaprompt) | `/feature-brief`                                          |
| Grill-me                       | `/feature-grill-me`                                       |
| Tests dérivés des specs        | `/feature-tests`                                          |
| Implémenter                    | `/feature-implement`                                      |
| Validation visuelle            | `/feature-visual`                                         |
| Revue                          | `/feature-review` (délègue au sous-agent `spec-reviewer`) |
| Contenu de PR                  | `/feature-pr`                                             |
| Reprendre                      | `/feature-resume`                                         |

Chaque skill définit ses déclencheurs (`description`), ses entrées, ses
sorties, ses étapes, ses commandes, ses critères de succès et ses conditions
de blocage.

## 3. Commandes (pnpm, depuis la racine)

| Commande                                                                   | Rôle                                                                                                                                                                              | Nouveau ? |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `pnpm verify:fast`                                                         | format des fichiers modifiés + specs + hygiène + architecture (graphe complet) + lint/typecheck/test:unit des paquets touchés et de leurs dépendants (`turbo --filter=...[HEAD]`) | oui       |
| `pnpm verify`                                                              | format complet, specs, hygiène, architecture, tests de l'outillage, prisma generate, typecheck, lint, test, build, `test:int` si Postgres/Redis sont joignables                   | oui       |
| `pnpm check:arch`                                                          | dependency-cruiser + classement des couches, avec référence                                                                                                                       | oui       |
| `pnpm check:specs`                                                         | features/specs/IDs/captures/brief/liens vers les tests                                                                                                                            | oui       |
| `pnpm check:hygiene`                                                       | `.only`, skips non approuvés, suppressions non justifiées                                                                                                                         | oui       |
| `pnpm check:pipeline`                                                      | tests de l'outillage du pipeline (`node --test`, fixtures isolées)                                                                                                                | oui       |
| `pnpm format:check` · `lint` · `typecheck` · `test` · `build` · `test:int` | inchangés, réutilisés par `verify`                                                                                                                                                | non       |

`verify` se contente d'orchestrer ces commandes et classe chaque résultat :
**pass**, **nouvel échec**, **échec préexistant**
(`scripts/pipeline/baselines/known-failures.json`), **ignoré** ou
**indisponible**. Il sort en 1 si et seulement s'il y a un nouvel échec, et
n'écrit jamais « tout vert » quand quelque chose a échoué ou n'a pas tourné.
`--report <fichier.md>` produit la table pour `progress.md`, `review.md` et
`pr.md`.

Les vérifications sont en lecture seule. Les corrections automatiques sont
séparées : `pnpm format`, et `eslint --fix` via lint-staged au commit.

## 4. Hooks Claude Code (`.claude/settings.json`)

| Évènement                                        | Script                                 | Fait                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostToolUse` (matcher `Edit\|Write\|MultiEdit`) | `scripts/pipeline/hooks/post-edit.mjs` | sur le **seul** fichier édité : prettier, eslint du paquet propriétaire, check-specs si c'est un doc de feature ou un test. Sort en 2 avec diagnostics.                           |
| `Stop`                                           | `scripts/pipeline/hooks/stop.mjs`      | barrière de fin peu coûteuse sur les fichiers modifiés : prettier, check-specs, check-hygiene, check-arch. Sort en 2 une fois ; le garde `stop_hook_active` empêche toute boucle. |

Les hooks appellent les mêmes outils que la CI, avec des tableaux d'arguments
fixes (pas de shell), des timeouts, et aucune commande tirée du texte d'une
feature. Ils ne modifient jamais de fichier, donc pas de récursion avec les
outils d'édition. Lint, typecheck et tests ne tournent pas à chaque arrêt
(trop lents) : `CLAUDE.md` impose `pnpm verify:fast` avant d'annoncer qu'une
tâche est terminée.

Vérification : tests par fixtures (`scripts/pipeline/test/hooks.test.mjs`).
**Exécution réelle observée** dans la session d'intégration : le hook
`PostToolUse` s'est déclenché sur les écritures de fichiers et a renvoyé ses
diagnostics (prettier, check-specs). Le hook `Stop` n'a pas été observé en
condition réelle à la date de rédaction : seuls ses tests de fixtures le
couvrent.

Commande manuelle équivalente si les hooks sont désactivés :

```bash
echo '{"tool_input":{"file_path":"<chemin>"}}' | node scripts/pipeline/hooks/post-edit.mjs
```

```bash
echo '{}' | node scripts/pipeline/hooks/stop.mjs
```

## 5. CI (`.github/workflows/ci.yml`)

Le job existant `check` est **étendu** (pas remplacé). Après le lint, il lance
désormais `check:specs`, `check:hygiene`, `check:arch` et `check:pipeline`, avec
la même installation et le même cache, sans job supplémentaire. Les jobs
`integration` et `security.yml` sont inchangés.

Contrôles recommandés comme requis (à activer par un admin dans la protection
de branche ; le pipeline ne la modifie pas) : `lint · typecheck · test · build`
et `integration (postgres + redis)`.

Observation locale à l'adoption : `pnpm build` échoue sur `@djafat/mobile` et
`@djafat/courier` (`expo export`, dette docs/36 §6.3). Le job CI `check` lance
`pnpm build` : s'il échoue de la même façon en CI, il était déjà rouge avant
le pipeline. Cela n'a pas été vérifié sur GitHub Actions depuis cette session.

## 6. Dette existante

| Dette                                                | Mécanisme                                     | Réduction                                           |
| ---------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| 4 cycles `auth`                                      | `baselines/architecture.json` (nominatif)     | FU-ARCH-01 ; `check:arch` signale l'entrée corrigée |
| 3 `eslint-disable` sans justification                | `baselines/hygiene.json`                      | ajouter ` -- raison` au prochain passage            |
| 4 `exhaustive-deps` préexistants                     | disable justifié sur la ligne exacte          | FU-REACT-01 pour les 2 fermetures périmées          |
| `mobile#build`, `courier#build`                      | `baselines/known-failures.json`               | `verify` signale quand ils repassent                |
| `test:unit` de l'API cassé (« No test files found ») | **corrigé** (`--dir src` doublait le préfixe) | —                                                   |

Toute nouvelle violation est rejetée. On n'ajoute une entrée de référence qu'avec
une raison, et jamais pour masquer son propre changement.

## 7. Reprendre, maintenir

- **Reprendre** : `/feature-resume`. L'état, ce sont les artefacts de
  `docs/features/FEAT-NNN-*/` ; il n'existe pas de base de session.
- **Ajouter une règle d'architecture** : `scripts/pipeline/architecture/policy.mjs`,
  plus un cas positif et un cas négatif dans `scripts/pipeline/test/check-arch.test.mjs`,
  plus une ligne dans `architecture-policy.md`.
- **Faire évoluer les modèles** : `docs/features/_templates/`. Les sections
  obligatoires sont listées dans `scripts/pipeline/check-specs.mjs`
  (`FEATURE_SECTIONS`, `SPEC_SECTIONS`) : modifier les deux ensemble.
- **Modifier un skill** : garder le frontmatter `name` égal au nom du dossier,
  et une `description` qui dit quand l'utiliser.
- **Instructions toujours chargées** : `CLAUDE.md`, à garder court. Le détail
  va dans les skills et dans `docs/pipeline/`.
- **Après toute modification de l'outillage** : `pnpm check:pipeline`, puis
  `pnpm verify`.

## 8. Intégrations futures (DRAFT)

Sandbox, Jira/pièces jointes, contexte GitHub, publication de PR :
[`draft-integrations.md`](draft-integrations.md). Rien n'est connecté.
