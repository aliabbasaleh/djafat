# Completed tasks

Tasks move here from [`BACKLOG.md`](BACKLOG.md) only when their acceptance criteria are met **and
the verification was actually run**. Each entry records what changed, where, and how it was checked.

## Entry template

```markdown
### T-nnn · Title

- **Completed:** YYYY-MM-DD · **Commit:** `abcdef1`
- **Resolves:** FINDING-ID (set its status to Resolved in FINDINGS.md)
- **What changed:** one or two sentences
- **Files:** paths
- **Verified by:** the command or manual check, and its result (e.g. "`pnpm --filter @djafat/api
test:int` — 96 passed"; "Chrome: login on :3000 → POST /auth/otp/request 202")
- **Not verified:** anything the check did not cover
- **New issues found:** IDs added to FINDINGS.md, or "none"
```

## Completed

### T-101 · Fix the SDK `fetch` binding

- **Completed:** 2026-11-13 · **Commit:** on the collaborator's branch, merged into `main` as `46d8cae` (pull request #1)
- **Resolves:** SDK-01
- **What changed:** `packages/sdk/src/http.ts` calls `fetch` as a plain function, so browsers no longer throw "Illegal invocation".
- **Files:** `packages/sdk/src/http.ts`
- **Verified by:** Chrome on 2026-11-13 with the code at `4c756e0` (application code identical on `main`): login through the real pages in all four web apps, `POST /v1/auth/otp/request` 202, verify 200.
- **Not verified:** WhatsApp and e-mail login.
- **New issues found:** none

### T-108 · Make the API integration suite runnable

- **Completed:** 2026-11-13 · **Commit:** on the collaborator's branch, merged into `main` as `46d8cae` (pull request #1)
- **Resolves:** TEST-01
- **What changed:** SWC transform for the integration tests, workspace build before seeding, limiter and fixture-hours resets, a rewritten walking skeleton.
- **Files:** `apps/api/test/**`, `.github/workflows/ci.yml`
- **Verified by:** hosted `integration` job green on the push of `46d8cae`; locally 94/94 on a fresh database (2026-11-13, with the new refund test of `fix/audit-blockers`).
- **Not verified:** —
- **New issues found:** none

### T-202 · Cash on delivery

- **Completed:** 2026-11-13 · **Commit:** on the collaborator's branch, merged into `main` as `46d8cae` (pull request #1)
- **Resolves:** PAY-02
- **What changed:** a cash order is placed instead of expiring, within the customer's trust limit (FEAT-015), and settled at delivery.
- **Files:** `apps/api/src/modules/{orders,payments,deliveries}/**`, `apps/worker`
- **Verified by:** browser run on 2026-11-13: cash order placed, accepted, readied, delivered; payment `succeeded`; ledger balanced (restaurant 4 000, courier 1 000, revenue 1 000).
- **Not verified:** the trust-limit refusals.
- **New issues found:** none

### AUDIT-3 · After-pull reminder shared with the collaborator

- **Completed:** 2026-11-11 · **Commit:** `5e379b3`, `7adfd6a` on branch `docs/audit-sync`, proposed to `main` in pull request [#2](https://github.com/aliabbasaleh/djafat/pull/2)
- **Asked for:** make the after-pull check run in the collaborator's Claude Code sessions too.
- **What changed:** hook moved to the versioned `.claude/settings.json`; `.gitignore` lines copied
  from the collaborator's branch so `.claude/settings.json` can be committed; checker no longer
  triggered by one's own commits; `docs_2/.gitattributes` added; `README.md` §4 rewritten.
- **Files:** `.claude/settings.json`, `.gitignore`, `docs_2/**`.
- **Verified by:** shared hook seen firing in a live session; trigger matrix tested (`pull`, `fetch`
  remind; `commit`, `revert` silent); `jq` validation; `pnpm format:check`.
- **Not verified:** the hook on the collaborator's machine (operating system and Claude Code version
  unknown); the merge of this branch into theirs (a conflict on `.claude/settings.json` is expected
  and documented in `README.md` §4).
- **New issues found:** none.

### AUDIT-2 · Audit documents moved to `docs_2/`; incremental sync after every pull

- **Completed:** 2026-11-11 · **Commit:** not committed (working tree)
- **Asked for:** keep the audit apart from the pre-existing `docs/` folder, and review what a
  collaborator's pushes add, remove and fix on every pull, with notes in the documents and the logs.
- **What changed:**
  - All 36 audit documents moved from `docs/` to `docs_2/`. `docs/README.md` restored under its own
    name; the root `README.md` restored to its committed version (its stale banner stays recorded
    as `DOC-01`, for its owner to fix).
  - `docs_2/README.md` rewritten: map of both folders, maintenance rules, the incremental audit sync
    procedure (§3) and how the reminder works (§4).
  - New `docs_2/history/SYNC_LOG.md` (S-000 baseline, S-001), `docs_2/history/LAST_REVIEWED_COMMIT`
    (the commits the documentation accounts for) and `docs_2/tools/audit-sync-check.sh` (read-only
    checker).
  - A Claude Code hook in `.claude/settings.local.json` (local to this machine, not tracked by Git)
    runs the checker on every prompt and after `git` commands that can move a branch.
  - First sync, S-001: the collaborator's 4 new commits reviewed; finding `OPS-05` added.
- **Files:** `docs_2/**`, `.claude/settings.local.json` (superseded by AUDIT-3). `docs/` and `README.md` unchanged from Git.
- **Verified by:** `git status --short -- docs README.md` prints nothing (both identical to the last
  commit); checker run against the real repository (found exactly the 4 new commits, silent once the
  marker moved) and against a throwaway clone for: everything reviewed, fast-forward onto reviewed
  commits, a new merge commit (HEAD and `origin/main` reported once), a new remote branch, a deleted
  remote branch, a vanished recorded commit, special characters in commit messages; JSON output
  parsed with `jq`; hook settings validated with `jq`.
  The `PostToolUse` hook was seen firing inside the running Claude Code session (a temporary
  sentinel line, removed afterwards).
- **Not verified:** the `UserPromptSubmit` hook in a live prompt — it uses the same command, tested
  by piping a prompt payload into it, but only the next user message can show it firing.
- **New issues found:** `OPS-05` (sync S-001).

### AUDIT-1 · Initial full audit and documentation system

- **Completed:** 2026-11-11 (evidence collected 2026-11-10) · **Commit:** not committed (working tree)
- **What changed:** documentation only; the living documentation set was created. No application
  code changed. _(Corrected 2026-11-11: the set was first written into `docs/`, with `docs/README.md`
  renamed and the root `README.md` banner edited; see AUDIT-2 for the move to `docs_2/` and the
  restoration of those files.)_
- **Files:** now `docs_2/` — 16 top-level documents, `applications/` (8), `modules/` (7),
  `tasks/` (4), `history/CHANGELOG.md`.
- **Verified by:** the checks listed in [`../TESTING_AND_QUALITY_ASSURANCE.md`](../TESTING_AND_QUALITY_ASSURANCE.md).
- **Not verified:** the two Expo apps on a device; behaviour with two API instances; the unmerged
  branches (read, not run); accessibility and performance.
- **New issues found:** the 62 findings in [`../FINDINGS.md`](../FINDINGS.md).

## Work completed before this register existed

Recorded in the French block reports (`docs/17` → `docs/36`) and the Git history (70 commits,
2026-09-10 → 2026-10-14). What of it was re-verified on 2026-11-10 is listed in
[`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) §4; nothing else from those reports should be
assumed verified.

Last updated: 2026-11-11 (AUDIT-3)

### T-103 · Fix refund arithmetic

- **Completed:** 2026-11-17 · **Commit:** `f0cbb09` (version `8e59bd4`), merged into `main` with pull request #4 (`44ae073`)
- **Resolves:** PAY-03
- **What changed:** both `SUM(amount_minor)` refund queries cast to `::bigint`, so the refund arithmetic no longer mixes a Decimal with bigints.
- **Files:** `apps/api/src/modules/payments/payments.service.ts`, `apps/api/test/refunds.int.spec.ts`
- **Verified by:** new integration test on PostgreSQL (partial refund → `partially_refunded`, excess → 409, remainder → `refunded`, ledger balanced), red before the fix and green after; integration suite 94/94 then; hosted `integration` job green on pull request #4.
- **Not verified:** refunds through the admin screens (the route needs a TOTP step-up).
- **New issues found:** none

### T-208 · Delivery code in the customer apps

- **Completed:** 2026-11-17 · **Commit:** `70cfd3b`, merged into `main` with pull request #4 (`44ae073`)
- **Resolves:** FE-03
- **What changed:** order tracking returns the delivery id; the SDK reads `GET /v1/deliveries/:id/code`; the site and the app show « Votre code de livraison » from pickup to handover.
- **Files:** `apps/api/src/modules/deliveries/order-tracking.service.ts`, `packages/sdk/src/orders.ts`, `apps/web/src/components/DeliveryCode.tsx`, `apps/web/src/app/commandes/[id]/page.tsx`, `apps/mobile/app/(app)/orders/[id].tsx`
- **Verified by:** unit tests (API, SDK); integration suite 94/94; Chrome on an isolated database: no code before pickup, a 4-digit code after it, the courier confirms with it, the order is delivered, the code is gone.
- **Not verified:** the mobile screen on a device (type-checked and linted only).
- **New issues found:** none

### T-104 · Validate secrets at boot

- **Completed:** 2026-11-17 · **Commit:** `aa0d58d`, merged into `main` with pull request #4 (`44ae073`)
- **Resolves:** SEC-01
- **What changed:** in production `loadApiEnv` refuses placeholder, short (under 32 characters), reused or malformed (not 32-byte AES) secrets, naming the variable and never its value; elsewhere the API starts and logs them.
- **Files:** `packages/config/src/env.ts`, `packages/config/src/env.spec.ts`, `apps/api/src/common/config/config.service.ts`, `.env.example`
- **Verified by:** six unit tests (five fail on the previous code); the built API started three ways: production with the `.env.example` values exits with code 1 naming the five secrets, production with generated secrets answers `/health`, development starts and warns.
- **Not verified:** whether development should refuse too: a decision for the team (`DOC-03`).
- **New issues found:** `DOC-03`

### T-107 · Verify the webhook signature before recording the event

- **Completed:** 2026-11-17 · **Commit:** `2319186`, merged into `main` with pull request #4 (`44ae073`)
- **Resolves:** PAY-05
- **What changed:** the payment webhook checks the signature before writing its `webhook_events` idempotency row; a rejected request leaves nothing and is logged.
- **Files:** `apps/api/src/modules/payments/payments.service.ts`, `apps/api/test/webhook-forgery.int.spec.ts`, `docs/24-bloc-5-payment.md`
- **Verified by:** the audit's two requests replayed on PostgreSQL (forgery → 401 and no row; the genuine webhook → `ok`, payment succeeded, order placed; replay → `duplicate`); that test and three unit tests fail on the previous code; integration suite 95/95.
- **Not verified:** —
- **New issues found:** none

### T-102 · Enforce provider enablement when creating a payment

- **Completed:** 2026-11-17 · **Commit:** `a017f48`, merged into `main` with pull request #4 (`44ae073`)
- **Resolves:** PAY-01
- **What changed:** payment creation applies the payment screen's rule (`listAvailablePaymentMethods`: enabled configuration for the order's restaurant, city, currency and amount; active provider) and refuses anything else with 409 before writing; the stored method is the provider's.
- **Files:** `apps/api/src/modules/payments/payments.service.ts`, `apps/api/src/modules/payments/payments-test-support.ts`, `apps/api/src/modules/payments/payments-provider-enablement.spec.ts`, `apps/api/test/payment-enablement.int.spec.ts`
- **Verified by:** the finding's Verify step on PostgreSQL (disabled row → 409, order still `awaiting_payment`, no payment row; enabled → 201) and an unknown `methodCode`, which gave HTTP 500, now stored as the provider's; 12 of 14 unit tests fail on the previous code; API unit tests 899/899.
- **Not verified:** the mock provider in production is not registered since FEAT-002 (not re-checked here).
- **New issues found:** `TEST-04`

### T-407 · Let the pre-commit hook run ESLint

- **Completed:** 2026-11-27 (fix on `main` since 2026-11-13) · **Commit:** `b495b86` (merged with PR #1, `46d8cae`)
- **Resolves:** [`CI-03`](../FINDINGS.md#ci-03)
- **What changed:** `eslint` 9.17.0 in the root `devDependencies`, so lint-staged finds it from the repository root.
- **Files:** `package.json`
- **Verified by:** 2026-11-27, sync S-055 — in a fresh worktree, the hook first refused a commit with ESLint's own
  messages (not ENOENT), then accepted the 379-file merge `e245d2c` (9 ESLint batches, 32 s), with no extra `PATH`.
