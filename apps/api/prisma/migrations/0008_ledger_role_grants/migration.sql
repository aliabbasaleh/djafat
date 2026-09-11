-- 0008_ledger_role_grants — completes D-03 from docs/17 §9.
--
-- 0007_ledger_foundation revoked INSERT/UPDATE/DELETE on the ledger/wallet
-- tables from PUBLIC and granted them to the `djafat_ledger` role, but two
-- things were still missing for the app to actually use it:
--   1. the connecting app role must be a MEMBER of `djafat_ledger` to be able
--      to `SET LOCAL ROLE djafat_ledger` inside a transaction ;
--   2. `djafat_ledger` needs SELECT on those tables too (never granted to
--      PUBLIC by default in PostgreSQL — only the owner has it).
-- `current_user` is used instead of a hard-coded role name so this works
-- identically in dev (`djafat`), CI (`djafat`) and any future prod role.

DO $$
BEGIN
  EXECUTE format('GRANT djafat_ledger TO %I', current_user);
END
$$;

GRANT SELECT ON ledger_accounts, ledger_entry_groups, ledger_entries, wallet_balances TO djafat_ledger;
