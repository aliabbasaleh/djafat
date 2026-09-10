# apps/api — integration tests

Integration tests (`*.int.spec.ts`) run against **real** PostgreSQL + Redis
(`pnpm infra:up`) and are executed by `pnpm --filter @djafat/api test:int`.

At Bloc 0 the suite is empty — it is populated from Bloc 0.5 onward:

- repositories against a real Postgres (migrations applied)
- `LedgerRepository.persistEntryGroup` idempotency + immutability triggers
- `PrismaIdempotencyStore` concurrency (`ON CONFLICT DO NOTHING`)
- `OutboxService` transactional write
- `/v1/health` + `/v1/ready` end-to-end
