# Application: `apps/admin`

The back-office console for DJAFAT staff: support, finance and administrators. French.

|                    |                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| **State**          | **Broken** in a browser ([`SDK-01`](../FINDINGS.md#sdk-01)); behind that defect it is a read-mostly console  |
| **Stack**          | Next.js 15.1.3 · React 19 · `@djafat/ui` · `@djafat/sdk`                                                     |
| **Size**           | 19 source files, ≈1 550 lines                                                                                |
| **Tests**          | None                                                                                                         |
| **Build / run**    | ✅ `next build`; served and driven in headless Chrome on 2026-11-10                                          |
| **Port**           | 3002                                                                                                         |
| **Who can use it** | `admin`, `super_admin`, `support`, `finance` (a customer account is refused with a clear message — verified) |

## 1. Structure

```text
src/app/
├── login/                      OTP login with a staff-role check
└── admin/
    ├── page.tsx                dashboard: five link cards
    ├── users/ · users/[id]/    search; detail with roles, history, actions
    ├── orders/                 list with status and restaurant filters
    ├── restaurants/            list, status, balance on demand
    ├── couriers/               list, suspend / reinstate
    └── finance/                totals and platform accounts
src/components/   DataTable
src/lib/          api · auth-storage · format
```

## 2. Features

Observed with the SDK defect worked around in the browser, except where marked CODE.

| Feature                                                                   | State                          | Notes                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Login                                                                     | Broken as shipped              |                                                                                                                                 |
| Dashboard                                                                 | Partially Completed            | Links only; no figures, no alerts                                                                                               |
| User search and detail                                                    | Completed                      | Phone or name; roles and action history (detail page: CODE)                                                                     |
| Suspend, block, reactivate a user                                         | Completed, under-protected     | No hierarchy check, no step-up ([`ADM-02`](../FINDINGS.md#adm-02))                                                              |
| **Grant / revoke a role**                                                 | **Broken**                     | The API requires an MFA step-up; the console has no MFA screen, so the action can only fail ([`ADM-03`](../FINDINGS.md#adm-03)) |
| MFA enrolment and verification                                            | Not Implemented                | No file in the app mentions it                                                                                                  |
| Order list                                                                | Partially Completed            | Raw status identifiers; no detail page; no action                                                                               |
| Intervene on an order (cancel, reassign, force a delivery)                | Not Implemented                | No routes either ([`ORD-01`](../FINDINGS.md#ord-01), [`DLV-02`](../FINDINGS.md#dlv-02))                                         |
| Restaurant list and balance                                               | Partially Completed            | No create, activate, edit, coordinates, commission                                                                              |
| Courier list                                                              | Partially Completed            | Shows a UUID and a status; no name or phone; no onboarding                                                                      |
| Suspend / reinstate a courier                                             | Completed                      | API verified by role test                                                                                                       |
| Finance view                                                              | Completed (read-only)          | Totals owed, platform account balances                                                                                          |
| Refunds                                                                   | Not Implemented in the console | The API route crashes anyway ([`PAY-03`](../FINDINGS.md#pay-03))                                                                |
| Settlements, payouts                                                      | Not Implemented in the console | [`PAY-06`](../FINDINGS.md#pay-06)                                                                                               |
| Platform settings, commission rules, payment configuration, feature flags | Not Implemented                | Seed or SQL only                                                                                                                |
| Audit log viewer                                                          | Not Implemented                | History is shown per user only                                                                                                  |
| Support tooling (customer lookup → orders → actions)                      | Not Implemented                |                                                                                                                                 |

## 3. Observations

- As built, staff can **look** and **suspend**. None of the operations a live service needs daily —
  refund, cancel, re-dispatch, onboard a restaurant or a courier — can be done here.
- The API permits `finance` to refund and settle but gives that role no way to pass the MFA check
  ([`ADM-01`](../FINDINGS.md#adm-01)).
- An `admin` can block a `super_admin` ([`ADM-02`](../FINDINGS.md#adm-02)).
- Administrator tokens, including a 30-day refresh token, are in `localStorage`
  ([`SEC-05`](../FINDINGS.md#sec-05)); the session ends after 15 minutes ([`FE-02`](../FINDINGS.md#fe-02)).
- The first administrator can only come from the development seed ([`SEC-02`](../FINDINGS.md#sec-02)).
- No error, loading or not-found pages of its own.
- Interface review: [`../UI_UX_AUDIT.md`](../UI_UX_AUDIT.md) §4.

## 4. Outstanding tasks

T-101 (SDK) → T-213 (MFA for all staff roles) → T-214 (MFA screens; refunds, order actions,
onboarding) → T-303 (hierarchy guard) → T-311 (delivery override) → T-207 (token refresh) →
T-307 (token storage) → T-602 (browser tests).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
