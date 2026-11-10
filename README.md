# DJAFAT

Plateforme de livraison multi-plateforme (repas, puis produits du quotidien) — Tchad, lancement N'Djamena.
Monorepo TypeScript : **multi-pays, multi-devise, multi-provider de paiement** dès la conception.

> **État : Bloc 0 — Foundations.** Socle technique uniquement (aucune fonctionnalité métier).
> Voir [`docs/17-bloc-0-implementation.md`](docs/17-bloc-0-implementation.md) pour le rapport, et
> [`docs/16-final-architecture-validation.md`](docs/16-final-architecture-validation.md) pour le checkpoint d'architecture.

> **Feuille de route et versions : [`docs/ROADMAP.md`](docs/ROADMAP.md)** ·
> travailler depuis chez soi : [`docs/TRAVAILLER-EN-LOCAL.md`](docs/TRAVAILLER-EN-LOCAL.md) ·
> mise en ligne : [`infra/deploy/README.md`](infra/deploy/README.md)

## Architecture

Toute la conception est dans [`docs/`](docs/) (`README.md` + `01` → `16`). Points d'entrée :

- [`docs/01-architecture-generale.md`](docs/01-architecture-generale.md) — vue d'ensemble, décisions verrouillées A1–A9
- [`docs/05-architecture-backend.md`](docs/05-architecture-backend.md) — modular monolith NestJS, **DAG de modules**
- [`docs/06-schema-postgresql.md`](docs/06-schema-postgresql.md) — modèle de données (`Money` générique, ledger, multi-pays)
- [`docs/08-architecture-paiement.md`](docs/08-architecture-paiement.md) — abstraction `PaymentProvider`
- [`docs/13-structure-git-et-dossiers.md`](docs/13-structure-git-et-dossiers.md) — arborescence, CI, qualité
- [`docs/14-roadmap-et-risques.md`](docs/14-roadmap-et-risques.md) — roadmap (blocs 0 → 13), priorités P0–P3

## Structure

```
apps/       api · worker · web · admin · restaurant · mobile
packages/   types · core · validation · config · tokens · i18n · sdk · testing · tsconfig · eslint-config
infra/      docker-compose · docker/ · mock-psp · mock-sms
docs/       conception + rapports de blocs
```

## Démarrage local

```bash
# Prérequis : Node >= 20, pnpm >= 9, Docker
corepack enable                      # active pnpm
cp .env.example .env                 # placeholders — adapter si besoin
pnpm install
pnpm infra:up                        # PostgreSQL+PostGIS, PgBouncer, Redis, MinIO, Mailhog, mock-psp, mock-sms
pnpm db:migrate && pnpm db:seed      # migrations 0001–0007 + seed Tchad / N'Djamena / XAF
pnpm dev                             # api + worker + web (mobile : `pnpm --filter @djafat/mobile start`)
```

## Contrôles

```bash
pnpm verify:fast   # pendant le travail : périmètre modifié + contrôles graphe complet
pnpm verify        # vérification complète, classée (nouveau / préexistant / indisponible)
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Pipeline de développement agentique (Claude Code : features → specs → tests →
revue → PR) et politique d'architecture : [`docs/pipeline/`](docs/pipeline/README.md).

## Règles non négociables (voir `docs/15` / `docs/16`)

- **Argent** : type `Money { minor: bigint; currency: string }` partout. Jamais `float`, jamais `amountXaf`.
- **Grand livre** : seul le module `ledger` écrit `ledger_*` / `wallet_*`. Les autres passent par `LedgerPort`.
- **DAG de modules** : aucun cycle. `orders` n'importe **jamais** `payments` (`OrderAmountPort` + événements).
- **Idempotence financière** : garantie PostgreSQL (contraintes). Redis = accélération, jamais la vérité.
- **Paiement** : `PaymentProvider` + `ProviderCapabilities` + registry data-driven. Aucun `if (provider === ...)`.
- **Secrets** : jamais dans Git. `gitleaks` en CI + hook.

## Licence

Propriétaire — DJAFAT. Tous droits réservés.
