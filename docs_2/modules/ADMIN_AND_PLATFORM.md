# Module: administration and platform configuration

`apps/api/src/modules/admin`, `modules/platform`, and the `admin/*` routes owned by other modules
(orders, catalog, couriers, ledger, payments). Design intent:
`docs/30-bloc-9-admin-operations-security.md`, `docs/31-bloc-9.1-hardening.md`.

**State: Partially Completed.** Staff can search, read and suspend. The operations a running
service needs every day are missing, and two of the ones that exist cannot be reached.

## 1. What exists

| Capability                                              | Route                                    | Roles                                               | State                                           | Evidence                                                    |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Search users; user detail with roles and action history | `GET /admin/users`, `/admin/users/:id`   | admin, super_admin, support                         | Completed                                       | LIVE                                                        |
| Grant, revoke a role                                    | `POST`, `DELETE /admin/users/:id/roles…` | admin, super_admin + step-up                        | Completed in the API; unusable from the console | LIVE — [`ADM-03`](../FINDINGS.md#adm-03)                    |
| Suspend, block, reactivate a user                       | `POST /admin/users/:id/…`                | admin, super_admin                                  | Completed, under-protected                      | LIVE — [`ADM-02`](../FINDINGS.md#adm-02)                    |
| List orders                                             | `GET /admin/orders`                      | admin, super_admin, support                         | Completed                                       | LIVE                                                        |
| List restaurants; a restaurant's balance                | `GET /admin/restaurants…`                | admin, super_admin (+ finance for balance)          | Completed                                       | LIVE                                                        |
| List couriers; a courier's balance; suspend, reinstate  | `/admin/couriers…`                       | admin, super_admin, support (+ finance for balance) | Completed                                       | LIVE (list); role walls LIVE                                |
| Platform finance view                                   | `GET /admin/finance/balances`            | admin, super_admin, finance                         | Completed                                       | LIVE                                                        |
| List and record settlements                             | `/admin/settlements`                     | admin, super_admin, finance + step-up to record     | Implemented                                     | Unreachable for finance — [`ADM-01`](../FINDINGS.md#adm-01) |
| Refund a payment                                        | `POST /payments/:id/refund`              | admin, super_admin, finance + step-up               | Broken                                          | LIVE — [`PAY-03`](../FINDINGS.md#pay-03)                    |
| Trigger dispatch for an order                           | `POST /deliveries`                       | admin, super_admin, support                         | Implemented                                     | Not exercised                                               |
| Public configuration for clients                        | `GET /config/public`                     | public                                              | Completed                                       | LIVE                                                        |

**Platform configuration** lives in three tables — `platform_settings` (time-outs, radii, limits,
fee), `feature_flags`, `commission_rules` — plus `payment_provider_configs`. `PlatformService`
reads them with defaults from `packages/config/src/constants.ts`. `GET /config/public` exposes the
country, city, currency, order time-out, feature flags and minimum application versions.

## 2. What is missing

| Need                                                                        | State                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Cancel an order; intervene on a stuck order                                 | Not Implemented ([`ORD-01`](../FINDINGS.md#ord-01))                        |
| Re-issue a delivery code; force-complete a delivery                         | Not Implemented ([`DLV-02`](../FINDINGS.md#dlv-02))                        |
| Activate, review or reject a restaurant; set its coordinates and commission | Not Implemented ([`DLV-01`](../FINDINGS.md#dlv-01))                        |
| Onboard a courier (documents, vehicle, approval)                            | Not Implemented — a bare role grant                                        |
| Payouts                                                                     | Not Implemented ([`PAY-06`](../FINDINGS.md#pay-06))                        |
| Change a setting, a flag, a commission rule, a payment configuration        | Not Implemented — SQL or seed only                                         |
| Read the audit log across the platform                                      | Not Implemented — per-user history only                                    |
| Dashboards and figures                                                      | Not Implemented                                                            |
| Staff alerts in the console                                                 | Not Implemented — the events exist ([`NOTIF-01`](../FINDINGS.md#notif-01)) |
| MFA enrolment and step-up in the console                                    | Not Implemented ([`ADM-03`](../FINDINGS.md#adm-03))                        |
| Create the first administrator safely                                       | Not Implemented ([`SEC-02`](../FINDINGS.md#sec-02))                        |
| Impersonation or "view as" for support                                      | Not Implemented                                                            |

## 3. Assessment

**Strong:** staff-wide access requires a staff role _and_ a permission; the role-grant rules stop
self-promotion and stop an administrator creating another; sensitive financial routes demand a
recent second factor; every role and status change is recorded with its author.

**Weak:**

- **The role that should handle money cannot.** `finance` is authorised for refunds and
  settlements, which demand a step-up it is not allowed to enrol for.
- **Protection is uneven.** Granting a courier role needs a second factor; blocking a super
  administrator does not, and is open to any administrator.
- **Settings are code-adjacent.** Changing the delivery fee or the offer time-out means a database
  statement by a developer. Settings are also re-read from the database on each use, without a
  cache.
- **`platform_settings` holds 8 rows where about 20 settings are defined** after seeding; the rest fall
  back to constants, so the table does not show the values in force.
- **Operational events have no audience** in the console.

## 4. Findings and tasks

`ADM-01` → T-213 · `ADM-03` → T-214 · `ADM-02` → T-303 · `SEC-02` → T-302 · `ORD-01` → T-204 ·
`DLV-02` → T-311 · `DLV-01` → T-212 · `PAY-06` → T-216.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
