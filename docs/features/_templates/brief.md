---
feature: FEAT-XXX
specs: [SPEC-XXX-01@1]
---

# FEAT-XXX — Brief d'exécution

<!--
"Métaprompt" de la feature, produit par le skill feature-brief. C'est un
ARTEFACT lu par Claude Code au moment d'implémenter — pas un mécanisme
d'appel de modèle. `specs` épingle la version exacte de chaque spec :
`pnpm check:specs` refuse un brief périmé.
-->

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-XXX-01.md` (v1)
- Références visuelles : …
- Règles : `CLAUDE.md`, `docs/pipeline/architecture-policy.md`, `docs/pipeline/quality-rules.md`

## Fichiers concernés et abstractions à réutiliser

| Fichier | Rôle actuel | Changement prévu | Couche |
| ------- | ----------- | ---------------- | ------ |
| …       | …           | …                | …      |

## Stratégie de test dérivée des specs

| Scénario         | Niveau | Fichier de test | Oracle (ce que la spec exige) |
| ---------------- | ------ | --------------- | ----------------------------- |
| SPEC-XXX-01-SC01 | …      | …               | …                             |

## Commandes de vérification

```bash
pnpm verify:fast
pnpm --filter <package> test:unit -- <fichier>
pnpm verify
```

## Critères de fin

- [ ] Chaque scénario lié à au moins un test qui cite son ID, et vert
- [ ] `pnpm verify` : aucun nouvel échec
- [ ] Revue (`/feature-review`) sans constat bloquant
- [ ] `progress.md` à jour, `pr.md` préparé
