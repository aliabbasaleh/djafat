---
feature: FEAT-004
specs: [SPEC-004-01@1, SPEC-004-02@1]
---

# FEAT-004 — Brief d'exécution

## Sources

- Feature : `feature.md` — Specs : `specs/SPEC-004-01.md` (v1), `specs/SPEC-004-02.md` (v1)
- Règles : `CLAUDE.md`, `docs/pipeline/architecture-policy.md` (les fronts passent par `@djafat/sdk` ; `lib/` ne dépend pas de `components/`)

## Fichiers concernés et abstractions à réutiliser

| Fichier                                               | Rôle actuel                  | Changement prévu                                 | Couche       |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------ | ------------ |
| `packages/sdk/src/http.ts`                            | client HTTP                  | option `RequestOptions.accessToken`              | adapter      |
| `packages/sdk/src/auth.ts`                            | —                            | **nouveau** : `createAuthClient(http).signOut`   | adapter      |
| `packages/sdk/src/index.ts`                           | `createApiClient`            | expose `auth`                                    | adapter      |
| `apps/{web,admin,restaurant}/src/lib/auth-storage.ts` | stockage `localStorage`      | `getRefreshToken()`                              | client-logic |
| `apps/{web,admin,restaurant}/src/lib/session.ts`      | —                            | **nouveau** : `signOut()` (SDK + `clearSession`) | client-logic |
| `apps/web/src/components/CartIndicator.tsx`           | bouton déconnexion           | appelle `signOut()`                              | presentation |
| `apps/{admin,restaurant}/src/app/*/layout.tsx`        | bouton déconnexion           | `signOut()` puis redirection                     | presentation |
| `apps/{courier,mobile}/lib/auth-context.tsx`          | `signOut` efface SecureStore | lit la session, puis `api.auth.signOut`          | client-logic |

Réutilisés : `ApiHttp`, `ApiClientError`, le stockage de chaque app, et les
endpoints `logout`/`refresh` existants. Aucun changement côté backend.

## Stratégie de test dérivée des specs

| Scénario         | Niveau             | Fichier de test                           | Oracle (ce que la spec exige)                                    |
| ---------------- | ------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| SPEC-004-01-SC01 | SDK (fetch simulé) | `packages/sdk/src/auth.spec.ts`           | logout avec `Bearer acc-1` avant `clearLocal` ; `{revoked:true}` |
| SPEC-004-01-SC02 | SDK                | idem                                      | refresh `{refresh}`, puis logout avec le nouveau jeton           |
| SPEC-004-01-SC03 | SDK                | idem                                      | pas d'erreur, `clearLocal`, `reason:'network'`                   |
| SPEC-004-01-SC04 | SDK                | idem                                      | 1 seul refresh, `reason:'already-invalid'`                       |
| SPEC-004-01-SC05 | SDK                | idem                                      | 500 → pas de refresh, `reason:'server'`                          |
| SPEC-004-01-SC06 | SDK                | idem                                      | pas de refresh sans jeton, `reason:'already-invalid'`            |
| SPEC-004-02-SC01 | revue              | `review.md`                               | boutons web/admin/restaurant → `signOut()`                       |
| SPEC-004-02-SC02 | revue              | `review.md`                               | contextes courier/mobile → `api.auth.signOut`                    |
| SPEC-004-02-SC03 | client-logic       | `apps/restaurant/src/lib/session.spec.ts` | renvoie le jeton stocké, `null` si absent ou bloqué              |

## Commandes de vérification

```bash
pnpm --filter @djafat/sdk test:unit
pnpm --filter @djafat/restaurant test:unit
pnpm verify:fast
pnpm verify
```

## Critères de fin

- [x] Tests écrits avant le code, échec constaté, puis verts
- [x] typecheck et lint verts sur les 5 apps
- [x] Revue sans constat bloquant, `pr.md` préparé
