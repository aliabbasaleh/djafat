-- 0007_ledger_foundation — the general-ledger core (single writer).
--
-- Pulled forward into Bloc 0 (docs/15 §8.2 was updated) so that the "single
-- writer" guarantee is enforceable now: ledger_entries / ledger_entry_groups
-- are append-only (trigger), and write privileges belong to `djafat_ledger`.
-- Settlement/payout/dispute tables and wallet_transactions come in Bloc 0.5 / 5.

CREATE TABLE ledger_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('asset','liability','revenue','expense','equity','contra')),
  owner_type text CHECK (owner_type IN ('djafat','psp','restaurant','courier','customer')),
  owner_id   uuid,
  currency   char(3) NOT NULL REFERENCES currencies(code),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_uk UNIQUE NULLS NOT DISTINCT (code, owner_type, owner_id, currency)
);

CREATE TABLE ledger_entry_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN
                    ('order_accrual','funds_available','settlement','payout','refund',
                     'dispute','cash_reconciliation','adjustment')),
  idempotency_key text NOT NULL UNIQUE,
  currency        char(3) NOT NULL REFERENCES currencies(code),
  order_id        uuid,
  payment_id      uuid,
  memo            text,
  posted_at       timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  entry_group  uuid NOT NULL REFERENCES ledger_entry_groups(id),
  account_id   uuid NOT NULL REFERENCES ledger_accounts(id),
  direction    text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     char(3) NOT NULL REFERENCES currencies(code),
  memo         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, created_at);
CREATE INDEX ledger_entries_group_idx ON ledger_entries (entry_group);

-- Wallet balances are a PROJECTION of the ledger, written only by the ledger
-- module in the same transaction as the entry group (docs/15 AD-02).
CREATE TABLE wallet_balances (
  owner_type      text NOT NULL CHECK (owner_type IN ('restaurant','courier')),
  owner_id        uuid NOT NULL,
  currency        char(3) NOT NULL REFERENCES currencies(code),
  pending_minor   bigint NOT NULL DEFAULT 0,
  available_minor bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id, currency)
);

-- Immutability: ledger rows are append-only. Corrections are new 'adjustment' groups.
CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entry_groups_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entry_groups
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Single-writer defence in depth: only `djafat_ledger` may write these tables.
-- The application connects as the owner (which retains privileges); the ledger
-- module wraps its writes in `SET LOCAL ROLE djafat_ledger` from Bloc 0.5.
REVOKE INSERT, UPDATE, DELETE ON ledger_accounts, ledger_entry_groups, ledger_entries, wallet_balances FROM PUBLIC;
GRANT  INSERT, UPDATE, DELETE ON ledger_accounts, ledger_entry_groups, ledger_entries, wallet_balances TO djafat_ledger;
GRANT  USAGE, SELECT ON SEQUENCE ledger_entries_id_seq TO djafat_ledger;
