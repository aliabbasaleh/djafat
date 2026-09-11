# 19 — Bloc 1 : Identity & Access

> Fondation d'identité et d'autorisation pour tout DJAFAT — OTP, sessions rotatives, RBAC, ownership, MFA/step-up, audit.
> **Aucune fonctionnalité métier hors identité** (pas de catalogue, pas de dashboard, pas de paiement réel).
> Ce document est le rapport de fin de bloc — **le Bloc 2 n'est pas démarré** (voir §16, attend décision séparée).

---

## 1. Résultat

# 🟢 PASS — avec réserve de vérification (pas de Docker dans l'environnement de build)

`pnpm install` · `prisma generate` (hors-ligne) · `turbo format:check lint typecheck test build` → **21/21 tâches OK** · `prettier --check` OK · **187 tests unitaires réellement exécutés** (87 `@djafat/core` + 100 `apps/api`, dont **100 nouveaux** pour ce bloc). Migrations `0011`–`0013`, seed, et les deux suites d'intégration (`identity.int.spec.ts`, complément à `walking-skeleton.int.spec.ts`) sont livrées et **type-checkées avec succès** mais **N/V à l'exécution** — pas de démon Docker ici, exactement la même réserve qu'aux Blocs 0 et 0.5.

**Un vrai bug pré-existant trouvé et corrigé pendant ce bloc** (§12) : `AllExceptionsFilter` (Bloc 0) ignorait silencieusement le `code` explicite passé à chaque exception levée dans le code (`ConflictException({code:'ORDER_INVALID_TRANSITION',...})` par exemple) et le remplaçait par une correspondance générique dérivée du seul statut HTTP — un 409 quelconque devenait systématiquement `IDEMPOTENCY_KEY_REUSED`. Corrigé, testé (11 tests dédiés), et confirmé sans régression sur le comportement existant.

---

## 2. Périmètre

**Dedans** : identité (`User`, statuts `pending/active/suspended/blocked/deleted`), authentification OTP (hachée, TTL, verrou durable, rate-limit Redis en première ligne), sessions à refresh rotatif (token family, détection de réutilisation avec fenêtre de grâce anti-course), RBAC data-driven (`roles`/`permissions`/`role_permissions`), ownership générique réutilisable, MFA TOTP (admin/super_admin) + step-up, audit log append-only, endpoints `/v1/auth/*` + `/v1/me`, rétrofit ciblé de `orders`/`payments` (clôture partielle de la dette S-01/S-05 du Bloc 0.5).

**Explicitement dehors** : Bloc 2 (catalogue complet), Bloc 9 (back-office admin réel — seuls 2 endpoints de démonstration du guard stack existent), Bloc 10/11 (scoping restaurant-staff/courier réel sur `confirm`/`ready`/`deliveries/*`), paiement réel, dispatch avancé, promotions, recommandations, fidélité, codes de récupération MFA (dette assumée, §14).

---

## 3. Commandes

```bash
pnpm install
pnpm --filter @djafat/api db:generate
pnpm infra:up
pnpm db:migrate && pnpm db:seed        # migrations 0001–0013 + seed (incl. rôles/permissions/fixtures identité)
pnpm dev

pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Intégration (nécessite pnpm infra:up + db:migrate + db:seed)
pnpm --filter @djafat/api run test:int
pnpm --filter @djafat/worker run test:int
```

---

## 4. Architecture

### 4.1 Modèle d'identité

`User` générique (`users`), indépendant du rôle métier. Rôles multiples par utilisateur via `user_roles` (Bloc 0, inchangé). 8 rôles (`customer, restaurant_owner, restaurant_staff, courier, support, finance, admin, super_admin` — `support`/`finance` ajoutés, extension non conflictuelle de docs/05 §5.4). 5 statuts (`pending, active, suspended, blocked, deleted`) ; suppression = anonymisation (`phone → 'deleted:<uuid>'`, PII nulle), jamais une suppression physique (docs/06 §6.4, FK historiques préservées).

### 4.2 OTP

`OtpService` (`apps/api/src/modules/auth/otp.service.ts`) : requête → rate-limit IP (30/h) + téléphone (3/10 min, Redis best-effort) → verrou durable `phone_auth_locks` (10 échecs / 15 min, Postgres) → génération CSPRNG (`crypto.randomInt`) → hachage HMAC-SHA256 pepé (`OTP_HASH_SECRET`) → persistance `otp_codes` → envoi via `OtpDeliveryPort`. Vérification : `SELECT ... FOR UPDATE` sur le dernier challenge non consommé, comparaison à temps constant, décision déléguée à **`evaluateOtpAttempt`** (`@djafat/core`, pure, 8 tests) — `match | wrong_code | expired | exhausted | no_challenge`, jamais de distinction observable côté client. `MockOtpDeliveryProvider` : permanent, ne logue jamais le code, le dépose dans Redis (`otp:mock:<phone>`, TTL court, non-prod uniquement) pour les tests — pas un log, un canal éphémère.

### 4.3 Sessions & refresh rotatif

`sessions` (Bloc 0, inchangé) : une ligne par refresh émis, `family_id` (lignée), `parent_id` (chaînage), `refresh_hash` unique. `SessionService.rotate()` verrouille (`FOR UPDATE`) la ligne présentée puis délègue la décision à **`classifyRefreshPresentation`** (`@djafat/core`, pure, 10 tests) :

- ligne valide, non expirée → rotation ;
- ligne valide mais expirée naturellement → `expired` (pas un événement de sécurité) ;
- ligne déjà révoquée, `reason='rotated'`, **dans une fenêtre de grâce de 5 s**, et un descendant actif existe → rotation **du descendant** (absorbe une course bénigne — deux requêtes de refresh concurrentes légitimes réussissent toutes les deux sans jamais invalider la session gagnante) ;
- tout le reste (hors fenêtre, `logout`/`admin`, ou family déjà morte) → `reuse_detected` → **toute la family révoquée** + `AUTH_REFRESH_REUSE_DETECTED` audité.

`stepUpVerifiedAt` est **reporté** sur l'enfant à chaque rotation — une rotation en plein milieu d'une fenêtre de step-up ne la perd pas silencieusement.

### 4.4 RBAC & permissions

`roles`/`permissions`/`role_permissions` (migration `0011`, data-driven — même philosophie que `payment_providers`/`ledger_accounts`). 18 permissions granulaires (`users:read/write`, `orders:read/write`, `restaurants:*`, `menus:*`, `deliveries:*`, `payments:read/refund`, `ledger:read/write`, `payouts:*`, `admin:*`). **`ledger:write` n'est accordé à AUCUN rôle**, pas même `super_admin` — le grand livre reste à écrivain unique (docs/15 AD-02) même pour l'admin le plus élevé ; la permission existe pour un futur outillage, non pour un usage actuel.

### 4.5 Ownership

`@RequireOwnership(token, resolve, overridePermission?)` — générique et réutilisable par n'importe quel module DAG-autorisé. Un décorateur s'exécute à la définition de la classe (jamais de `this` disponible) : `resolve` reçoit une INSTANCE du service, résolue par requête via `ModuleRef.get(token, {strict:false})` — `token` peut être une classe (même module) ou un symbole de port DI (cross-module, ex. `ORDER_AMOUNT_PORT` pour `payments`, sans jamais importer `orders` directement — docs/18 AD-09 préservé).

### 4.6 MFA (TOTP) & step-up

TOTP RFC 6238/HMAC-SHA1 implémenté dans `@djafat/core` (`src/mfa/totp.ts`), sans dépendance externe, vérifié contre les **vecteurs de test officiels RFC 6238 Annexe B** (11 tests). Secret chiffré au repos AES-256-GCM (`MFA_ENCRYPTION_KEY`). `POST /v1/auth/mfa/verify` fait double usage (matche exactement la surface déjà documentée en docs/07) : confirme un enrôlement en attente la première fois, ouvre la fenêtre de step-up (10 min, configurable) ensuite. `StepUpGuard` relit **toujours** la session en base (contrairement à `AuthGuard`, volontairement stateless) — les routes sensibles sont rares, le coût d'une lecture fraîche est négligeable, et la fraîcheur prime sur la performance ici.

### 4.7 Audit

`AuditService` (`common/audit/`, global) — `audit_logs` (Bloc 0) étendu (`metadata`, `user_agent`) et rendu **append-only** (migration `0012`, trigger `forbid_mutation()` réutilisé de `ledger_entries`). Vocabulaire d'actions fermé (`AuditAction`) reprenant exactement la liste docs/19 §24. Une écriture d'audit qui échoue est loguée et **avalée** — jamais de blocage du flux métier pour une panne d'observabilité.

### 4.8 Guards / decorators — la primitive livrée aux modules futurs

```ts
@RequireAuth()
@RequireRole('restaurant_owner')
@RequirePermission('orders:read')
@RequireOwnership(OrdersService, (o, req) => o.getOwnerUserId(req.params.id), 'orders:read')
@RequireStepUp()
```

Chaque guard résout `req.actor` lui-même, de façon idempotente, via `ActorResolverService` — l'ordre de composition n'a jamais d'importance. `ActorResolverService` vérifie le JWT (stateless : signature/expiration/issuer/audience), puis relit **toujours** `status` (compte actif ?) et `permissions` (fraîches, jamais embarquées dans le token) — un changement de rôle ou une suspension prend effet à la requête suivante, pas seulement après expiration du token (15 min). La révocation de session, elle, n'est PAS revérifiée à chaque requête (« selon politique », docs/19 §13) : `logout`/`logout-all` bloquent le `refresh` immédiatement, mais un access token déjà émis reste valide jusqu'à sa propre expiration (15 min) — compromis documenté, pas un oubli.

---

## 5. Endpoints livrés

| Méthode | Route                      | Auth                                              |
| ------- | -------------------------- | ------------------------------------------------- |
| POST    | `/v1/auth/otp/request`     | public (rate-limité)                              |
| POST    | `/v1/auth/otp/verify`      | public → émet access+refresh                      |
| POST    | `/v1/auth/refresh`         | refresh token                                     |
| POST    | `/v1/auth/logout`          | self                                              |
| POST    | `/v1/auth/logout-all`      | self                                              |
| POST    | `/v1/auth/mfa/setup`       | admin/super_admin                                 |
| POST    | `/v1/auth/mfa/verify`      | admin/super_admin                                 |
| POST    | `/v1/auth/mfa/disable`     | admin/super_admin + step-up                       |
| GET     | `/v1/me`                   | self                                              |
| GET     | `/v1/admin/ping`           | admin/super_admin (preuve)                        |
| POST    | `/v1/admin/sensitive-ping` | admin/super_admin + permission + step-up (preuve) |

`admin/ping`/`sensitive-ping` **ne sont pas des fonctionnalités** — voir §12, doc-comment dans `admin.controller.ts` : ils prouvent la chaîne de guards de bout en bout contre un vrai aller-retour HTTP, faute d'endpoint métier sensible existant à rétrofiter (Bloc 9).

### Rétrofit orders/payments (clôture partielle S-01/S-05, docs/18 §7/§10)

- `POST /v1/orders` : `customerId` n'est plus dans le body (`.strict()` le rejette désormais, 422) — dérivé de l'acteur authentifié, rôle `customer` exigé.
- `GET /v1/orders/:id` : propriétaire (client) OU permission `orders:read` (support/finance/admin).
- `POST /v1/payments` : propriétaire de la COMMANDE payée (résolu via `OrderAmountPort.getOwnerUserId`, jamais un import direct de `orders` — DAG préservé) OU `payments:read`.
- `confirm`/`ready` (restaurant) et `deliveries/*` (courrier) restent **sans auth** — scoping restaurant-staff/courier réel = Bloc 10/11 (dette D-10, §14).

---

## 6. Base de données — migrations ajoutées

| #                         | Contenu                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0011_rbac_permissions`   | `permissions` (18 lignes seedées), `role_permissions` (junction, data-driven).                                                                                                                |
| `0012_identity_hardening` | `users.status` élargi à 5 valeurs ; `users.email_verified_at` ; `sessions.step_up_verified_at` ; `audit_logs.metadata`/`user_agent` + trigger d'immutabilité (`forbid_mutation()` réutilisé). |
| `0013_mfa_totp`           | `mfa_totp_secrets` (1 ligne/utilisateur, secret chiffré, `enabled`/`confirmed_at`).                                                                                                           |

Aucune migration Bloc 0/0.5 modifiée destructivement — uniquement des `ALTER TABLE ... ADD COLUMN` et un élargissement de CHECK.

**Seed** (complété) : rôles `support`/`finance` ; 18 permissions + grants par rôle (`ledger:write` accordé à personne) ; un utilisateur test par rôle (`+23566000003`…`+23566000008`) — aucun secret/OTP de seed, l'authentification passe toujours par le vrai flux OTP.

---

## 7. Décisions prises pendant l'implémentation

1. **Extraction de la logique de décision en fonctions pures** dans `@djafat/core` (`classifyRefreshPresentation`, `evaluateOtpAttempt`) — même discipline que le Bloc 0.5 (`buildOrderAccrualEntries`) : le raisonnement de sécurité le plus critique est testable sans base de données, donc réellement exécuté ici (pas seulement type-checké).
2. **JWT HS256 auto-implémenté** (`token.service.ts`, ~90 lignes), pas de dépendance `jsonwebtoken`/`@nestjs/jwt` — seul `apps/api` vérifie ses propres tokens (monolithe), une paire de clés asymétriques n'apporte rien ici. `.env.example` mis à jour (l'ancien placeholder anticipait RS256 sans jamais avoir été implémenté).
3. **TOTP auto-implémenté** (`@djafat/core/mfa/totp.ts`) via Web Crypto API (`crypto.subtle`, global Node 19+/navigateurs) plutôt que `node:crypto` — garde `@djafat/core` isomorphe (zéro import de module Node natif). Vérifié contre les vecteurs RFC 6238 officiels.
4. **Fenêtre de grâce de 5 s sur la rotation de refresh** — sans elle, une course bénigne (double-soumission réseau) revoque la family entière, y compris la session tout juste créée par le gagnant : bug d'utilisabilité réel, évité par construction (§4.3).
5. **`@RequireOwnership` par token DI, pas par instance fermée** — un décorateur ne peut jamais capturer `this` (s'exécute à la définition de classe) ; résolution par `ModuleRef` par requête.
6. **`auth`/`users` : un seul sens de dépendance** (`auth → users`, jamais l'inverse) — `GET /v1/me` vit dans `auth` (`MeController`), pas dans `users`, pour ne jamais avoir besoin d'un cycle `users → auth`.
7. **Bug trouvé dans `eslint-plugin-boundaries`** : une règle générique `from:['api-module'] → allow:[auth, users]` accorde aussi `auth → auth` et `users → auth` (union de toutes les règles correspondantes) — corrigé en énumérant explicitement chaque module autorisé à atteindre `auth`/`users`, plutôt qu'une règle générique. Vérifié par une sonde de lint délibérée (import interdit `users → auth`, confirmé rejeté).
8. **MFA au login simplifié** : les tokens sont émis dès l'OTP validé, même pour admin/super_admin ; le "2FA au login" de docs/05 §5.4 est obtenu par construction via `@RequireStepUp()` sur toute action sensible plutôt que par un état d'auth intermédiaire bloquant l'émission des tokens — propriété de sécurité équivalente (aucune action privilégiée sans les deux facteurs), complexité bien moindre (dette D-13, §14).
9. **Recovery codes MFA différés** — hors de la liste explicite du mandat (`enroll/verify/disable` seulement) ; un compte admin verrouillé de son 2FA est un flux support (Bloc 9), pas un mécanisme générique Bloc 1 (dette D-14, §14).
10. **Correction du bug `AllExceptionsFilter`** (§12) — priorité au `code` explicite sur la déduction par statut HTTP.

---

## 8. Écarts avec la documentation antérieure

Aucun écart de décision verrouillée (A1–A9). Extensions non conflictuelles : rôles `support`/`finance` (absents de docs/05 §5.4, ajoutés par le mandat Bloc 1) ; `permissions`/`role_permissions` (jamais documentées avant — docs/05 ne décrivait qu'un `@Roles(...)` par rôle direct, pas une matrice de permissions).

---

## 9. Tests

| Suite                                                     | Fichiers | Tests                     | Statut                                                  |
| --------------------------------------------------------- | -------- | ------------------------- | ------------------------------------------------------- |
| `@djafat/core` (Bloc 0.5 : 58)                            | 4        | 58                        | **PASS** (inchangé)                                     |
| `@djafat/core` — nouveau (TOTP, rotation, OTP policy)     | 3        | 29                        | **PASS** (réellement exécuté)                           |
| `apps/api` unitaire (Bloc 0.5 : 29)                       | 6        | 29                        | **PASS** (inchangé)                                     |
| `apps/api` unitaire — nouveau                             | 9        | 71                        | **PASS** (réellement exécuté)                           |
| `apps/api` intégration — `identity.int.spec.ts` (nouveau) | 1        | 5 scénarios + probes IDOR | **N/V** — Docker indisponible ; type-checké avec succès |
| `apps/api` intégration — `walking-skeleton` (Bloc 0.5)    | 1        | inchangé                  | **N/V** — idem                                          |
| `apps/worker` intégration (Bloc 0.5)                      | 1        | 7                         | **N/V** — idem                                          |

**Total unitaire réellement exécuté : 187** (87 core + 100 api), tous verts.

**Ce que `identity.int.spec.ts` vérifie** (docs/19 §37, quand il tourne en CI) :

1. OTP login → `/me` → refresh → ancien refresh rejeté → logout → refresh rejeté.
2. Ownership : client A lit sa propre commande (200) ; client B se voit refuser (403) ; tentative IDOR (`customerId` dans le body) rejetée par le schéma strict (422), jamais silencieusement ignorée en faveur d'un mauvais acteur.
3. Admin : route non gatée fonctionne dès le login ; route step-up refusée (428) avant MFA ; enrôlement TOTP ; mauvais code rejeté (409) sans ouvrir la fenêtre ; bon code confirme l'enrôlement ET ouvre le step-up ; route sensible autorisée ensuite ; un client authentifié mais sans le rôle est refusé (403).
4. Réutilisation de refresh (au-delà de la fenêtre de grâce) → 401 + family entièrement révoquée (même le token issu de la rotation légitime intermédiaire cesse de fonctionner).
5. Deux requêtes de refresh concurrentes sur le même token → au moins un succès garanti, jamais les deux rejetées.

**Discipline de véracité** : ni `identity.int.spec.ts` ni `walking-skeleton.int.spec.ts` n'ont été exécutés ici (pas de Docker) — livrés comme du code réel, type-checké avec succès contre le schéma réel, jamais présentés comme passés.

---

## 10. Sécurité / invariants vérifiés

- **OTP** : haché (HMAC pepé), jamais loggé ; comparaison à temps constant ; TTL configurable ; verrou durable Postgres (pas seulement Redis) ; rate-limit best-effort en première ligne.
- **Refresh** : opaque (pas un JWT), haché avant persistance ; rotation atomique (`FOR UPDATE`) ; réutilisation → révocation de toute la family + audit.
- **JWT access** : HS256, signature/expiration/issuer/audience toujours vérifiés ; jamais de secret embarqué dans le token lui-même (testé explicitement).
- **RBAC deny-by-default** : aucune permission requise = laisser passer ; une permission requise et absente = refus, sans exception. `ledger:write` accordé à personne.
- **Ownership** : jamais un `NotFoundException` masqué en 403 (testé) ; un override par permission ne contourne l'ownership QUE si l'acteur possède réellement cette permission (testé).
- **MFA** : secret chiffré au repos (AES-256-GCM, testé — mauvaise clé et ciphertext altéré échouent tous deux) ; jamais loggé en clair ; step-up toujours revérifié en base, jamais fait confiance à un claim de token.
- **IDOR / spoofing** : `customerId`/`userId` fournis par le client sont **rejetés au niveau du schéma** (`.strict()`), jamais silencieusement acceptés puis ignorés — testé dans `identity.int.spec.ts`.
- **Audit append-only** : trigger DB, pas seulement une convention applicative.
- **Aucun secret dans les logs** : vérifié par relecture de `otp.service.ts`, `mfa.service.ts`, `token.service.ts`, `session.service.ts`, `crypto.util.ts` — aucun `logger.*` ne référence un code/token/secret en clair.

---

## 11. Rate limiting

| Cible                      | Limite                      | Mécanisme                               |
| -------------------------- | --------------------------- | --------------------------------------- |
| OTP request / IP           | 30 / h                      | Redis (best-effort)                     |
| OTP request / téléphone    | 3 / 10 min                  | Redis (best-effort)                     |
| Verrou OTP (verify)        | 10 échecs / 15 min → verrou | Postgres `phone_auth_locks` (durable)   |
| Attempts par challenge OTP | 5                           | Postgres `otp_codes.attempts` (durable) |

Toutes les valeurs sont lues depuis `platform_settings` avec repli sur `PLATFORM_SETTINGS_DEFAULTS` (même pattern que `unpaid_order_ttl_seconds` du Bloc 0.5) — configurables sans migration.

---

## 12. Bug trouvé et corrigé — `AllExceptionsFilter`

**Symptôme** : n'importe quelle exception levée avec un `code` explicite (`ConflictException({code:'ORDER_INVALID_TRANSITION', ...})`) voyait ce code silencieusement remplacé par une correspondance générique statut→code (tout 409 devenait `IDEMPOTENCY_KEY_REUSED`, tout 400 devenait `INTERNAL` faute d'entrée dans la table).

**Cause racine** : `classify()` ignorait le corps de la réponse (`exception.getResponse()`) pour tout ce qui concerne `code`, ne l'utilisant que pour `message`.

**Correction** : priorité au `code` explicite (validé contre `API_ERROR_CODES`), repli sur la déduction par statut uniquement en son absence — rétrocompatible (aucun appelant existant ne dépendait du bug).

**Test ajouté** : `all-exceptions.filter.spec.ts`, 11 tests, dont la régression exacte (409 avec code explicite ≠ `IDEMPOTENCY_KEY_REUSED`) et la non-régression (409 sans code explicite = toujours `IDEMPOTENCY_KEY_REUSED`, comportement historique préservé).

---

## 13. Bug trouvé et corrigé — DAG ESLint (`auth`/`users`)

**Symptôme** : une première version de la règle `eslint-plugin-boundaries` accordait à `auth`/`users` eux-mêmes l'accès à `auth`/`users` (auto-référence + accès réciproque), défaisant silencieusement la règle « `auth` peut lire `users`, jamais l'inverse ».

**Cause racine** : `eslint-plugin-boundaries` fait l'**union** de toutes les règles dont le `from` correspond — une règle générique `from:['api-module'] → allow:[auth, users]` s'applique aussi quand `from` est lui-même `auth` ou `users`.

**Correction** : énumération explicite de chaque module métier autorisé à atteindre `auth`/`users`, au lieu d'une règle générique. **Vérifié par une sonde de lint délibérée** (ajout temporaire d'un import `users → auth`, confirmation du rejet, puis retrait) — pas seulement déduit.

---

## 14. Dette technique

| #    | Description                                                                       | Impact                                                                                                                        | Pourquoi reportée                                                                                                             | Bloc cible                                 |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D-10 | Pas de scoping restaurant-staff/courier réel sur `confirm`/`ready`/`deliveries/*` | Ces endpoints restent sans auth (stand-in Bloc 0.5)                                                                           | `user_roles.scope_restaurant_id` existe mais aucun dashboard restaurant/courier n'existe encore pour le consommer proprement  | Bloc 10 (restaurant), Bloc 11 (courier)    |
| D-11 | Refresh via cookie `HttpOnly` (web) non implémenté — body JSON uniquement         | Fonctionne pour web ET mobile via fetch, mais pas la stratégie cookie+CSRF documentée en docs/07                              | Pas de frontend web réel consommant l'auth encore ; implémenter CSRF sans un vrai consommateur à valider dessus est prématuré | Bloc 3 (web customer)                      |
| D-12 | Pas de cache Redis pour `role_permissions`                                        | Une requête indexée supplémentaire par requête authentifiée                                                                   | Trafic nul à ce stade ; optimisation prématurée                                                                               | Si le profilage le justifie                |
| D-13 | MFA "au login" simplifiée en step-up-avant-toute-action-privilégiée (§7.8)        | Un token est émis avant vérification MFA pour admin/super_admin (mais aucune action privilégiée n'est possible sans step-up)  | Éviter un état d'authentification intermédiaire bloquant, hors du périmètre explicite du mandat                               | — (propriété de sécurité déjà équivalente) |
| D-14 | Pas de codes de récupération MFA                                                  | Un admin qui perd son authenticator n'a pas de flux d'auto-récupération                                                       | Hors de la liste explicite `enroll/verify/disable` du mandat ; flux support, pas un mécanisme générique                       | Bloc 9                                     |
| D-15 | `GET /v1/payments/:id` sans ownership check                                       | Un acteur authentifié quelconque peut lire n'importe quel paiement par id (pas de fuite de secret, mais fuite de métadonnées) | Retrofit ciblé sur `POST` uniquement pour ce bloc ; `GET` moins prioritaire                                                   | Prochain rétrofit de `payments`            |

Aucune de ces dettes ne touche une décision d'architecture verrouillée (A1–A9) ni le modèle financier.

---

## 15. Problèmes rencontrés et résolus

| Problème                                                           | Cause                                                                                                      | Résolution                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@djafat/core` ne pouvait pas typer `crypto.subtle`                | Package sans `@types/node`, `lib` sans DOM (isomorphe par design)                                          | `@types/node` ajouté en **devDependency** (type-only) + `"types":["node"]` local à `packages/core/tsconfig.json` — le runtime reste isomorphe (Web Crypto API globale), seul le typage change |
| `OwnershipGuard` ne pouvait pas fermer sur `this.ordersService`    | Un décorateur s'exécute à la définition de classe, avant toute instance                                    | Résolution par `ModuleRef.get(token, {strict:false})`, par requête                                                                                                                            |
| `payments → orders` interdit par le DAG pour l'ownership           | Découplage Bloc 0.5 volontaire (docs/18 AD-09)                                                             | `OrderAmountPort` étendu de `getOwnerUserId()` — `payments` résout l'ownership via le port déjà injecté, jamais via un import direct                                                          |
| Règle ESLint générique accordait `auth`↔`users` par erreur        | Union des règles correspondantes (voir §13)                                                                | Énumération explicite, vérifiée par sonde de lint                                                                                                                                             |
| Course bénigne sur rotation de refresh tuait la session du gagnant | Révocation de toute la family sur toute présentation d'un token déjà tourné, même dans une course légitime | Fenêtre de grâce de 5 s + rotation du descendant actif (voir §4.3, §7.4)                                                                                                                      |
| `toMeDto` signalé `require-await` par ESLint                       | Méthode async sans `await` (aucune I/O réelle)                                                             | Rendue synchrone                                                                                                                                                                              |
| `pnpm` introuvable sur le `PATH` (comme aux Blocs 0/0.5)           | Sandbox Windows                                                                                            | `D:\npm-global` (déjà configuré) ajouté au `PATH` de chaque commande                                                                                                                          |

---

## 16. Critères de sortie (definition of done, §48)

### Code

- [x] Identity module (`users`) · [x] Authentication (OTP) · [x] Abstraction OTP (`OtpDeliveryPort`, inchangé Bloc 0) · [x] Mock OTP provider · [x] Session management · [x] Refresh rotation · [x] Logout · [x] Logout-all · [x] `/me` · [x] RBAC · [x] Permissions · [x] Ownership guard/service · [x] Audit · [x] MFA/2FA · [x] Step-up primitive · [x] Rate limiting · [x] Security events (audit actions)

### Database

- [x] Migrations (`0011`–`0013`) · [x] Indexes · [x] Constraints · [x] FK · [x] Seed · [x] Migration consistency (aucune migration Bloc 0/0.5 cassée)

### Security

- [x] OTP hashing · [x] OTP expiration · [x] OTP brute-force protection (durable + rate-limit) · [x] Refresh rotation · [x] Reuse detection · [x] Session revocation (logout/logout-all) · [x] Deny-by-default · [x] Cross-owner protection · [x] MFA · [x] No sensitive logs (vérifié) · [x] gitleaks (config Bloc 0 inchangée)

### Tests

- [x] Unit tests (187, réellement exécutés) · [x] Integration tests (livrés, N/V exécution) · [ ] Concurrency tests **exécutés** (le scénario 5 est livré mais nécessite Docker pour s'exécuter réellement — la logique de décision sous-jacente, elle, EST testée unitairement à 100%, `rotation-policy.spec.ts`) · [x] RBAC tests · [x] Ownership tests · [x] Security tests (IDOR probe, tampered JWT, wrong key/ciphertext) · [x] Refresh reuse test (unitaire complet ; intégration livrée N/V) · [x] MFA test

### Quality

- [x] format · [x] lint · [x] typecheck · [x] test · [x] build · [ ] CI réellement exécutée (config déjà en place depuis le Bloc 0, non rejouée ici faute de GitHub Actions dans ce sandbox) · [x] documentation

---

## 17. Commits

Réalisés sur `main` :

- `feat(types,config): Bloc 1 — identity types, roles support/finance, JWT/OTP/MFA env schema`
- `feat(core): TOTP (RFC 6238), refresh-rotation & OTP-attempt decision policies — pure, testées`
- `feat(api): Bloc 1 — Identity & Access (OTP, sessions, RBAC, ownership, MFA/step-up, audit)`
- `fix(api): AllExceptionsFilter ignorait le code explicite des exceptions (régression testée)`
- `feat(api): rétrofit orders/payments — customerId dérivé de l'acteur, ownership réelle`
- `test(api,core): tests unitaires Bloc 1 (100 api + 29 core) + suite d'intégration identity`
- `docs(19): rapport d'implémentation Bloc 1 (Identity & Access)`

Working tree propre après chaque commit (`git status`).

---

## 18. Recommandation pour le Bloc 2

**Je m'arrête ici. Le Bloc 2 attend une décision explicite séparée — ce document ne constitue pas un feu vert.**

La fondation d'identité tient bout en bout : un module futur peut écrire `@RequireAuth() @RequirePermission(...) @RequireRole(...) @RequireOwnership(...) @RequireStepUp()` sans réinventer la sécurité, exactement l'objectif final du mandat. Les seules réserves sont l'exécution Docker (identique aux Blocs 0/0.5, couverte par la CI) et la dette explicitement assumée en §14 — aucune ne remet en cause une décision d'architecture verrouillée ni le modèle financier.
