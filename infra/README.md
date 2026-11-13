# infra/

Local development stack + build/deploy assets. **Portable by design** (decision
A6): PostgreSQL, Redis and an S3-compatible store behind interfaces — no cloud
vendor SDK in application code. Scaleway (Paris) is the initial target; moving to
Hetzner / AWS / Azure / GCP is an IaC + endpoint change, not a code change.

## Contents

| Path                       | What                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `docker-compose.yml`       | Local stack: PostgreSQL 16 + PostGIS, **PgBouncer** (txn pooling, :6432), Redis, MinIO (S3), Mailpit, mock-psp, mock-sms |
| `docker/api.Dockerfile`    | Multi-stage build for `@djafat/api`                                                                                      |
| `docker/worker.Dockerfile` | Multi-stage build for `@djafat/worker`                                                                                   |
| `mock-psp/`                | Deterministic mock PSP (HMAC-signed webhooks) — dev/CI only                                                              |
| `mock-sms/`                | In-memory mock SMS gateway — lets tests read the OTP back                                                                |
| `deploy/`                  | Production / demo stack on one server (Compose + Caddy HTTPS + backups) — see `deploy/README.md`                         |

## Usage

```bash
pnpm infra:up      # docker compose up -d
pnpm infra:logs
pnpm infra:down
```

The app connects through **PgBouncer** (`DATABASE_URL` → :6432); Prisma Migrate
uses the direct connection (`DIRECT_DATABASE_URL` → :5432).
