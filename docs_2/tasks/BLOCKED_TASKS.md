# Blocked tasks

Tasks that cannot start or finish until someone outside the code decides or delivers something.
When a blocker is lifted, record the decision here (with the date and who took it), then move the
task back to `Not started` in [`BACKLOG.md`](BACKLOG.md).

| Task                                  | Blocked by              | Who can unblock           | What is needed, precisely                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-001** Choose the integration line | Decision                | Repository owner          | Which branch becomes the base: merge `claude/compassionate-franklin-k23vcj` into `main`, or cherry-pick. And what happens to `fix/payment-reliability-backlog`. See [`../UNMERGED_BRANCHES.md`](../UNMERGED_BRANCHES.md)                            |
| **T-202** Cash on delivery            | Product policy          | Product / operations      | Maximum order value payable in cash; whether new customers may pay cash; the courier cash ceiling and how couriers hand cash in; what happens when a customer refuses the order at the door                                                         |
| **T-203** Real OTP delivery           | External contract       | Business                  | An SMS (or WhatsApp) provider with coverage of Chadian operators, credentials for a test account, and a sender ID                                                                                                                                   |
| **T-205** Automatic refunds           | Business policy         | Product / finance         | For each failure point (restaurant rejects, restaurant never answers, customer cancels before/after preparation, no courier found, delivery fails): who bears the cost, full or partial refund, and whether the restaurant or courier is still paid |
| **T-215** Real mobile-money provider  | External access         | Business                  | Contract and sandbox credentials for Airtel Money and/or Moov Money, or an aggregator; their webhook and refund specifications (condition H1 in `docs/16`)                                                                                          |
| **T-216** Payouts                     | Business policy + T-215 | Finance                   | Payout frequency, minimum amount, method, who approves, and how cash collected by couriers is netted against what they are owed                                                                                                                     |
| **T-312** Who may create restaurants  | Product decision        | Product                   | Is restaurant self-registration intended? If yes, the approval workflow; if no, creation becomes staff-only                                                                                                                                         |
| **T-504** Pricing                     | Product decision        | Product                   | Delivery pricing model (zones or distance), whether tax applies and how it is shown, promotion rules                                                                                                                                                |
| **T-603** Deployment stack            | Hosting decision        | Technical lead / business | Provider and shape (single server or managed database), domain names, who holds production access, budget (condition H2 in `docs/16`)                                                                                                               |

## Decisions already recorded elsewhere

The French dossier fixes several policies that these decisions must stay consistent with
(`docs/15-audit-corrections.md`, decisions A1–A9), notably: DJAFAT absorbs payment-provider fees
(A2), funds are released to partners at delivery (A3), unpaid orders expire after 15 minutes (A4),
and the courier is paid the delivery fee (A5).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
