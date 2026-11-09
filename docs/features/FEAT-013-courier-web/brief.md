---
feature: FEAT-013
specs: [SPEC-013-01@1]
---

# FEAT-013 — Brief d'exécution

## Fichiers concernés

| Fichier                             | Changement                                                     | Couche       |
| ----------------------------------- | -------------------------------------------------------------- | ------------ |
| `apps/courier/lib/session-store.ts` | **nouveau** : choix du stockage de session selon la plateforme | client-logic |
| `apps/courier/lib/auth-storage.ts`  | passe par ce choix                                             | client-logic |
| `apps/courier/package.json`         | dépendances web d'Expo, commande `build:web`                   | config       |
| `.gitignore`                        | `dist-web/`                                                    | config       |

## Stratégie de test

| Scénarios             | Niveau           | Fichier                                  |
| --------------------- | ---------------- | ---------------------------------------- |
| SPEC-013-01-SC01…SC03 | unitaire         | `apps/courier/lib/session-store.spec.ts` |
| SPEC-013-01-SC04      | exécution réelle | `e2e-demo.md`                            |
