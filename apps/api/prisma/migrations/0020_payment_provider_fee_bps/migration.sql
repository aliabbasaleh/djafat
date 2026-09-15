-- 0020_payment_provider_fee_bps — PSP fee rate becomes DATA, not a hardcoded
-- constant (closes the Bloc 5 gap: MOCK_PSP_FEE_BPS was a Bloc-0.5 stand-in —
-- docs/18 §13, docs/24 §7). Additive, nullable: a NULL means "no override at
-- this scope", resolved with the same specificity order as commission_rules
-- (restaurant > city > country > global), falling back to 0 if nothing matches.

ALTER TABLE payment_provider_configs ADD COLUMN fee_bps int;
