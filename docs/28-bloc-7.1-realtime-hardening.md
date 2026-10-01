# Bloc 7.1 — Realtime hardening : multi-instance + expiration JWT WebSocket

> Verdict : 🟢 **GO**, dette restante inchangée depuis le Bloc 7 pour Docker/PostgreSQL
> (jamais exécuté contre une infrastructure réelle ici), méthodologie en checkpoints
> obligatoires appliquée intégralement — 4 checkpoints, tous 🟢 PASS, zéro régression.

---

## 1. Contexte

Le Bloc 7 a fermé la chaîne `Outbox → Redis Streams → DomainEventsConsumer → Gateway/Notifications`
et livré 775 tests. Deux dettes explicites restaient avant de considérer le
realtime production-ready :

1. **Fan-out Socket.IO mono-instance** : `IoAdapter` par défaut, aucune
   diffusion entre plusieurs processus API.
2. **Token JWT jamais revérifié après le handshake** : un acteur resté
   connecté gardait ses autorisations de room indéfiniment, même après
   expiration réelle de son token (15 min par défaut).

Ce bloc traite ces deux dettes, **et seulement elles** — aucune autre
fonctionnalité n'a été ajoutée ou modifiée.

## 2. Problème multi-instance

### 2.1 Cause exacte

```
main.ts (avant)
  app.useWebSocketAdapter(new IoAdapter(app))
```

`server.to(room).emit(...)` n'atteint que les sockets connectés **au process
qui exécute cet appel**. Deux instances API derrière un load balancer ne
partagent rien : un événement relayé par l'instance A n'atteint jamais un
client dont le socket est tenu par l'instance B.

### 2.2 Solution

`@socket.io/redis-adapter@8.3.0` — version vérifiée avant installation
(`npm view`) : peer dependency `socket.io-adapter@^2.5.4`, déjà présente
transitivement avec `socket.io@4.8.1` installé. API agnostique du client
Redis (`createAdapter(pubClient, subClient)`), donc **réutilise `ioredis`**,
déjà la seule bibliothèque Redis du dépôt — aucune dépendance concurrente
introduite.

```
apps/api/src/common/redis/socket-io-redis-adapter.ts
  attachSocketIoRedisAdapter(app, redisUrl)
    → deux connexions ioredis dédiées (pub + sub)
    → createAdapter(pub, sub)
    → app.useWebSocketAdapter(RedisIoAdapter)
```

Deux connexions dédiées car un client en mode souscription Redis ne peut
émettre aucune autre commande — même discipline que `DomainEventsConsumer`
(Bloc 7) pour sa lecture bloquante.

**Fallback non bloquant** : si Redis est injoignable au démarrage, les deux
connexions sont proprement fermées et l'instance démarre avec l'adaptateur
en mémoire par défaut (fan-out mono-instance uniquement) — jamais de blocage
du boot.

### 2.3 Ne jamais mélanger avec les Redis Streams du Bloc 7

Deux canaux Redis strictement distincts, documentés comme tels dans le code :

|           | Redis Streams (Bloc 7)                    | Adaptateur Socket.IO (Bloc 7.1)                                                                  |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Direction | Outbox → chaque instance                  | Une instance → sockets de toutes les instances                                                   |
| Primitive | `XADD` / `XREADGROUP` / `XACK`            | `PUBLISH` / `SUBSCRIBE` internes à l'adaptateur                                                  |
| Garantie  | Durable, at-least-once                    | Volatile (fire-and-forget)                                                                       |
| Rôle      | Fait arriver l'événement à chaque process | Fait arriver l'émission locale `.to(room).emit()` à tous les sockets, où qu'ils soient connectés |

## 3. Problème JWT expiré sur WebSocket

### 3.1 Cause exacte

`RealtimeGateway.handleConnection` résout l'acteur **une seule fois** via
`ActorResolverService.resolve()` et le met en cache dans
`actors: Map<string, AuthenticatedActor>` pour toute la durée de vie du
socket. `handleSubscribe` ne fait que lire cette map. Rien ne revérifie
jamais la validité du token après le handshake initial.

`TokenService.verifyAccessToken` vérifie `payload.exp <= now` à chaque appel,
de façon **synchrone et sans I/O** (HMAC + comparaison d'horodatage) — donc
réinvocable à coût négligeable pour une revérification périodique.
`JWT_ACCESS_TTL_SECONDS` par défaut : **900 s**.

### 3.2 Solution retenue

Option du mandat, implémentée telle quelle :

```
JWT expire
→ socket considérée non authentifiée
→ disconnect contrôlé
→ client renouvelle le JWT (REST /v1/auth/refresh, Bloc 1, inchangé)
→ reconnect
→ handshake authentifié
→ rooms réautorisées
```

**Changement minimal, conçu pour zéro impact sur l'existant** :

- `actors: Map<string, AuthenticatedActor>` — **strictement inchangée**. Toute
  l'autorisation de room continue de lire cette map exactement comme avant.
- Nouvelle map **séparée** : `tokenExpiry: Map<string, {client, exp}>`,
  peuplée à `handleConnection` par un second appel pur à
  `tokenService.verifyAccessToken(token)` — relecture du même champ `exp` que
  la vérification que `resolve()` effectue déjà en interne. **Aucune
  nouvelle logique d'authentification inventée** ; `TokenService` et le
  système de refresh du Bloc 1 ne sont pas modifiés.
- **Défense à deux niveaux** :
  1. `handleSubscribe` refuse immédiatement toute **nouvelle** jonction de
     room si le token est expiré → ferme la course entre l'instant
     d'expiration réel et le prochain balayage.
  2. Balayage périodique (`OnModuleInit`/`OnModuleDestroy`, **30 s**,
     `.unref()` pour ne jamais maintenir le process en vie) qui déconnecte
     toute socket dont le token a expiré, même si elle n'a rien redemandé.

### 3.3 Limite assumée

Entre l'instant réel d'expiration et le prochain tick de balayage (≤ 30 s),
une socket déjà abonnée à une room continue de **recevoir** les diffusions
déjà autorisées — elle ne peut jamais en obtenir une **nouvelle**. C'est une
fenêtre bornée et documentée, pas un gap non détecté comme au Bloc 7.

## 4. Checkpoints 0 → 4

### CHECKPOINT 0 — Inspection

Architecture actuelle cartographiée (`main.ts`, `RealtimeGateway`, `TokenService`,
`ActorResolverService`, versions exactes installées). Deux causes identifiées
avec précision, fichiers listés, solution proposée, risques énoncés. Verdict : 🟢.

### CHECKPOINT 1 — Adaptateur multi-instance

`@socket.io/redis-adapter` installé et branché. 3 tests unitaires (construction,
fallback non bloquant, libération des connexions). 5 tests d'intégration
multi-instance écrits (`realtime-multi-instance.int.spec.ts`), non exécutés
(Docker indisponible), mais typecheckés et lintés avec succès. Suite complète :
778/778, lint 23/23, typecheck 23/23. Verdict : 🟢.

### CHECKPOINT 2 — Expiration JWT

Gateway modifiée (nouvelle map `tokenExpiry`, double défense subscribe/sweep).
`realtime-connection.spec.ts` entièrement réécrit : les 10 scénarios du mandat
ainsi que les cas de course (multi-appareils, réutilisation de socket-id par
un autre utilisateur, token déjà expiré rejoué). Une régression de
**conception** trouvée et corrigée avant tout commit — voir §8. Suite
complète : 786/786, lint 23/23 (après correction d'une variable inutilisée),
typecheck 23/23, build 15/15. Verdict : 🟢.

### CHECKPOINT 3 — Adversarial combiné

`realtime-adversarial-combined.int.spec.ts` : séquence complète événement →
diffusion cross-instance → expiration → reconnexion → nouvel événement →
vérification d'autorisation ; acteur non autorisé refusé sur les deux
instances à chaque étape ; duplicata cross-instance livré deux fois ; gateway
B arrêtée sans affecter A ; client reconnecté après l'arrêt de son instance.
Deux scénarios du mandat explicitement **non recréés**, avec justification
(voir §9). Écrit, typecheck/lint propres, non exécuté. Aucune régression sur
la suite par défaut (786/786, le fichier étant exclu de `pnpm test` par
construction). Verdict : 🟢.

### CHECKPOINT 4 — Validation finale

`pnpm format:check` ✅ · `pnpm lint` ✅ 23/23 · `pnpm typecheck` ✅ 23/23 ·
`pnpm test` ✅ 786/786 · `pnpm build` ✅ 15/15. Docker confirmé indisponible
une seconde fois avant la rédaction de ce document. Verdict : 🟢.

## 5. Tests

| Fichier                                              | Tests                    | Exécuté                |
| ---------------------------------------------------- | ------------------------ | ---------------------- |
| `socket-io-redis-adapter.spec.ts`                    | 3                        | ✅                     |
| `realtime-connection.spec.ts` (réécrit)              | 24 (dont 13 nouveaux §2) | ✅                     |
| `courier-location-privacy.spec.ts` (fixture adaptée) | inchangé en nombre       | ✅                     |
| `realtime-multi-instance.int.spec.ts`                | 5                        | ❌ Docker indisponible |
| `realtime-adversarial-combined.int.spec.ts`          | 7                        | ❌ Docker indisponible |

Total suite unitaire : **775 → 786 (+11)**. Les 12 tests d'intégration
supplémentaires sont écrits et vérifiés par typecheck/lint, jamais exécutés.

## 6. Tests non exécutés

- Les deux fichiers `.int.spec.ts` ci-dessus, en totalité.
- À l'intérieur, un sous-scénario restera **non automatisable même avec
  Docker** : couper temporairement le conteneur Redis au milieu d'un test —
  orchestration d'infrastructure, pas un test unitaire/intégration classique.

## 7. Bugs découverts

| #   | Où                                                            | Nature                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —   | `realtime-connection.spec.ts` (mon propre fake, avant commit) | Les fakes `actorResolver.resolve`/`tokenService.verifyAccessToken` ne vérifiaient pas `exp`, ce qui aurait validé un comportement que le fake ne reproduisait pas fidèlement. Trouvé en exécutant les tests (2 échecs), corrigé avant tout commit — voir §8. |

Aucun bug de production découvert dans le code hérité du Bloc 7 au-delà des
deux dettes déjà connues et ciblées par ce mandat.

## 8. Bugs corrigés

Le seul bug trouvé pendant ce bloc (ci-dessus) a été corrigé immédiatement :
les deux fakes de test partagent désormais une seule fonction `isExpired`,
qui ne peuvent donc plus diverger entre elles — exactement comme en
production où les deux lectures passent par la même instance de
`TokenService`.

## 9. Dette restante

| Sujet                                          | Détail                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker/PostgreSQL**                          | Toujours indisponible dans cet environnement. Aucune migration, aucun test d'intégration realtime exécuté contre une infrastructure réelle depuis le Bloc 0.5.                                           |
| Scénario « worker redémarré »                  | Non recréé dans ce bloc — déjà couvert exhaustivement au niveau unitaire par `domain-events.consumer.spec.ts`/`outbox-relay.processor.spec.ts` (Bloc 7, reclaim `XAUTOCLAIM`, redelivery at-least-once). |
| Scénario « Redis temporairement indisponible » | Non automatisable dans un test Vitest unique — nécessite d'arrêter/redémarrer un service docker-compose. Reste un test de chaos à faire manuellement ou en CI dédiée.                                    |
| Fenêtre de 30 s                                | Une socket dont le token vient d'expirer peut encore recevoir des diffusions sur des rooms déjà rejointes jusqu'au prochain balayage. Borné et documenté, jamais un oubli.                               |

## 10. Risques

| Risque                                                  | Sévérité | Commentaire                                                                                                                                                             |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'adaptateur n'a jamais tourné contre un vrai Redis ici | Moyen    | Code typecheck/linté, logique de fallback testée unitairement ; comportement réel multi-instance non prouvé en dehors du raisonnement et des tests écrits non exécutés. |
| Balayage à 30 s sous forte charge (beaucoup de sockets) | Faible   | Itération simple sur une Map, coût négligeable même à plusieurs milliers de sockets ; aucune opération I/O par socket.                                                  |

## 11. Impact sur les Blocs 0–7

Aucune décision antérieure modifiée. `ActorResolverService`, `TokenService`,
le système de refresh/sessions du Bloc 1, la machine à états order/delivery,
`COURIER_FEE_POOL`, le DAG de modules, l'autorisation de room du Bloc 6.1/7 —
tous inchangés dans leur comportement. Le seul changement observable de
l'extérieur : une socket dont le token expire pendant qu'elle est connectée
finit maintenant par être déconnectée (sous 30 s au pire), alors qu'avant elle
restait connectée indéfiniment.

## 12. Recommandations futures

- Exécuter les deux suites `.int.spec.ts` dès qu'un environnement Docker est
  disponible, avant toute mise en production.
- Envisager un test de chaos dédié (hors Vitest) pour la coupure Redis en
  cours de fonctionnement.
- Si le TTL d'access token change significativement à la baisse, revoir la
  cadence du balayage (actuellement 30 s, indépendante du TTL).
