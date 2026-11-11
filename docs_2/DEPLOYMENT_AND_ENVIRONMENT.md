# Deployment and environment

How to run DJAFAT locally today (including the workarounds the audit needed), how it is configured,
what CI does, and how far it is from being deployable. No secret value appears here.

## 1. Prerequisites

| Tool                                | Version                   | Note                                                                                                                                                                               |
| ----------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                             | **22** (`.nvmrc`)         | `engines` allows `>=20 <25` and `.npmrc` sets `engine-strict=true`: Node 25 or later makes `pnpm install` stop with `ERR_PNPM_UNSUPPORTED_ENGINE` ([`OPS-04`](FINDINGS.md#ops-04)) |
| pnpm                                | 9.15.4 (`packageManager`) |                                                                                                                                                                                    |
| Docker with Compose v2              | recent                    | Needed for PostgreSQL/PostGIS, PgBouncer and Redis                                                                                                                                 |
| A real Chrome, or an Android device | —                         | The only way to see whether the apps work; unit tests do not show it                                                                                                               |

## 2. Running locally

The documented quick start (`README.md`) does not work as written. What works:

```bash
pnpm install --frozen-lockfile            # Node 22
pnpm --filter @djafat/api run db:generate # Prisma client

# Start only the services the code uses. `pnpm infra:up` fails: see OPS-01.
docker compose -f infra/docker-compose.yml up -d postgres pgbouncer redis
#   Apple Silicon: the PostGIS image has no arm64 build — add `platform: linux/amd64` to the
#   postgres service through a local override file.
#   If PostgreSQL already runs on your machine on 5432, remap the published port the same way
#   and point DIRECT_DATABASE_URL at it.

cp .env.example .env                      # then REPLACE the five secret placeholders (below)
set -a && source .env && set +a           # nothing loads .env for you

pnpm db:migrate && pnpm db:seed
pnpm turbo run build --filter='!@djafat/mobile' --filter='!@djafat/courier'
pnpm --filter @djafat/api dev             # http://localhost:3001/v1 — check /v1/ready
pnpm --filter @djafat/worker dev          # REQUIRED: without it no dispatch and no realtime
pnpm --filter @djafat/web dev             # :3000  (admin :3002, restaurant :3003)
```

Things that will surprise you:

- **Nothing reads `.env` automatically.** The API, the worker, the seed and the tests read
  `process.env` only. Export the file into your shell.
- **The worker is not optional.** It relays events and retries dispatch. If it is not running,
  orders stop at `ready` and no realtime event arrives; the API looks healthy throughout.
- **Login codes are not sent.** Read them from Redis: `redis-cli GET "otp:mock:+23566000001"`.
- **The web apps cannot log in from a browser** until [`SDK-01`](FINDINGS.md#sdk-01) is fixed.
- **The seeded test restaurant is open 11:00–22:00 N'Djamena time**; outside that window order
  creation is refused, correctly.
- `pnpm dev` at the root starts everything in parallel, including the two Expo apps.

## 3. Configuration

Validated at boot by `packages/config/src/env.ts`; the process refuses to start if a required
variable is missing. Names only:

| Group          | Variables                                                                                                                                                                                                                                    | Notes                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime        | `NODE_ENV`, `LOG_LEVEL`, `APP_TIMEZONE`                                                                                                                                                                                                      | `NODE_ENV` ∈ development, test, production                         |
| API            | `API_HOST`, `API_PORT`, `API_PUBLIC_URL`\*, `API_CORS_ORIGINS`, `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`                                                                                                                             | The two rate-limit values and `API_PUBLIC_URL` are read by no code |
| Database       | `DATABASE_URL`_, `DIRECT_DATABASE_URL`_, `LEDGER_DB_ROLE`                                                                                                                                                                                    | Pooled URL needs `pgbouncer=true`; direct URL is for migrations    |
| Redis          | `REDIS_URL`\*                                                                                                                                                                                                                                |                                                                    |
| Object storage | `OBJECT_STORAGE_ENDPOINT`_, `_REGION`_, `_BUCKET`_, `_ACCESS_KEY_ID`_, `_SECRET_ACCESS_KEY`\*, `_FORCE_PATH_STYLE`                                                                                                                           | Required, but no adapter exists                                    |
| Auth           | `JWT_ACCESS_SECRET`_, `REFRESH_TOKEN_HASH_SECRET`_, `OTP_HASH_SECRET`_, `MFA_ENCRYPTION_KEY`_, `DELIVERY_CODE_ENCRYPTION_KEY`\*, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `JWT_ISSUER`, `JWT_AUDIENCE`, `STEP_UP_WINDOW_SECONDS` | **Secrets.** See below                                             |
| OTP            | `OTP_CHANNELS`, `SMS_PROVIDER`, `SMS_MOCK_URL`                                                                                                                                                                                               | Read by no code                                                    |
| Payments       | `PAYMENT_MOCK_URL`, `PAYMENT_WEBHOOK_BASE_URL`\*                                                                                                                                                                                             | Read by no code                                                    |
| Observability  | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`                                                                                                                                                                             | Read by no code                                                    |
| Web apps       | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEFAULT_COUNTRY`, `NEXT_PUBLIC_DEFAULT_CITY`                                                                                                                                                        | Compiled into the bundle at build time                             |
| Expo apps      | `EXPO_PUBLIC_API_BASE_URL`                                                                                                                                                                                                                   |                                                                    |

\* required.

### Secrets

Five values must be replaced before anything starts. Generate each with `openssl rand -base64 32`
(the two encryption keys must decode to exactly 32 bytes and must differ from each other).

**The API does not check them.** It starts with the placeholders, in production mode too, and then
accepts tokens anyone can forge ([`SEC-01`](FINDINGS.md#sec-01)). Until T-104 is done, checking is
a human responsibility.

Runtime-tunable business settings (order time-out, offer time-out, dispatch radii, OTP limits) are
rows in `platform_settings`, with defaults in `packages/config/src/constants.ts`. There is no
screen or endpoint to change them; it is done in SQL.

## 4. Continuous integration

Two workflows on push to `main` and on pull requests; the security one also weekly.

| Job           | Steps                                                                      | State on `main`              |
| ------------- | -------------------------------------------------------------------------- | ---------------------------- |
| `check`       | install → Prisma generate → format → typecheck → lint → unit tests → build | ❌ at build                  |
| `integration` | PostgreSQL + Redis services → migrate → seed → API integration tests       | ❌ at seed                   |
| `gitleaks`    | Secret scan of the history                                                 | ❌ two test fixtures flagged |
| `audit`       | `pnpm audit --prod --audit-level high`                                     | ❌                           |

Causes and fixes: [`CI-01`](FINDINGS.md#ci-01). There is no deployment job, no image build, no
mobile build, no browser test, and no worker integration test. Local hooks: commitlint on commit
messages, lint-staged on commit, gitleaks on push if installed — although that scan reads the
staged changes, not the pushed commits, so it finds nothing ([`CI-02`](FINDINGS.md#ci-02)).

_(updated 2026-11-11, sync S-003)_ On pull requests `gitleaks-action` needs the run's
`GITHUB_TOKEN`. `main`'s workflow does not pass it, so the job stops there before scanning. Both
open pull requests add it, with read-only permissions. The weekly run scans the history of every
branch, not only `main`.

## 5. Build artefacts

| Artefact               | How                                                          | State                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                    | `nest build` → `apps/api/dist` (156 files)                   | ✅ built and run                                                                                                                                                                                                                                                                                                                                                                               |
| Worker                 | `tsc` → `apps/worker/dist`                                   | ✅ built and run                                                                                                                                                                                                                                                                                                                                                                               |
| Web, admin, restaurant | `next build` → `.next`                                       | ✅ built and served                                                                                                                                                                                                                                                                                                                                                                            |
| API and worker images  | `infra/docker/*.Dockerfile` — multi-stage, Node 22, non-root | **Not built during the audit — Needs Verification.** Two things to check when they are: the runtime stage copies the root `node_modules` (development dependencies included) but not `apps/api/node_modules` or `apps/worker/node_modules`, which is where pnpm's isolated layout puts each app's dependency links — the container may fail to resolve its imports; and the Prisma engine path |
| Web app images         | —                                                            | None exist                                                                                                                                                                                                                                                                                                                                                                                     |
| Mobile and courier     | `expo export`                                                | ❌ ([`MOB-01`](FINDINGS.md#mob-01)); the real path, `eas build`, has never been tried                                                                                                                                                                                                                                                                                                          |

## 6. Deployment readiness

`infra/deploy/` contains a placeholder file. Nothing below exists on `main`
([`OPS-02`](FINDINGS.md#ops-02)).

| Need                                            | State                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Target environment chosen (provider, topology)  | Not decided                                                                           |
| Production Compose or infrastructure code       | Not Implemented                                                                       |
| Reverse proxy, TLS, domain routing              | Not Implemented                                                                       |
| Secret management                               | Not Implemented (the design names a secret manager; none is wired)                    |
| Production data bootstrap without test accounts | Not Implemented ([`SEC-02`](FINDINGS.md#sec-02))                                      |
| Database migrations in the release process      | Manual command only                                                                   |
| Backups and a tested restore                    | Not Implemented                                                                       |
| Process supervision and restart                 | Not Implemented — a stopped worker went unnoticed for 26 hours in the October pilot   |
| Health checks                                   | Liveness works; readiness returns 200 when not ready ([`OPS-03`](FINDINGS.md#ops-03)) |
| Logs                                            | Structured JSON to stdout, secrets redacted; no shipping or retention                 |
| Error tracking, metrics, alerts                 | Not Implemented ([`OBS-01`](FINDINGS.md#obs-01))                                      |
| Rate limiting and proxy trust                   | Not configured ([`SEC-04`](FINDINGS.md#sec-04), [`SEC-06`](FINDINGS.md#sec-06))       |
| Real SMS and payment providers                  | Not Implemented ([`AUTH-01`](FINDINGS.md#auth-01), [`PAY-07`](FINDINGS.md#pay-07))    |
| Mobile release pipeline                         | Not Implemented                                                                       |
| Runbooks (deploy, roll back, incident, refund)  | Not written                                                                           |
| Staging environment                             | None                                                                                  |

A single-server production stack (Compose, Caddy, backups, secret generation) exists on the
unmerged branch; it was not reviewed in depth or run — see [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md).

_Sync S-001 (2026-11-11), branch only, read not run:_ the branch now has a one-command server
install (`infra/deploy/install.sh`, aimed at Oracle Cloud's free ARM servers) and a French
deployment guide. Two cautions before using it: in `MODE=live` the server starts without roles,
permissions or ledger accounts, and the obvious fix — running the seed — creates staff accounts on
fixture phone numbers ([`OPS-05`](FINDINGS.md#ops-05)); and the ARM database image is a community
build referenced by tag, worth pinning by digest.

## 7. Graceful behaviour observed

- The API and the worker handle `SIGTERM`: they close queues, connections and the HTTP server.
- If Redis or PostgreSQL is unreachable at start, the API still starts and reports it through `/v1/ready`.
- With Redis stopped, catalog reads kept working; after Redis returned, both processes recovered
  without a restart.

## 8. Before any shared or public environment

In order: T-104 (secrets) → T-302 (bootstrap) → T-102 (payment enablement) → T-105 (dependency
upgrades) → T-310 (readiness) → T-603 (stack, backups) → T-604 (monitoring).

Last updated: 2026-11-11 (sync S-001)
