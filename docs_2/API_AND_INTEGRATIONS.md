# API and integrations

The HTTP and realtime surface of `apps/api` on `main`, and what it connects to. The route tables
below were generated from the controllers' decorators and cover all 95 routes; rules that
live in the service layer are written in words.

## 1. Conventions

| Topic                 | Rule                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path             | `/v1` (URI versioning). Swagger UI at `/v1/docs`, disabled in production                                                                                                                                                                            |
| Format                | JSON in and out; bodies limited to 1 MB                                                                                                                                                                                                             |
| Authentication        | `Authorization: Bearer <access token>` — HS256, 15-minute lifetime                                                                                                                                                                                  |
| Money                 | `{ "minor": "12000", "currency": "XAF" }` — `minor` is a string of an integer, never a float                                                                                                                                                        |
| Idempotency           | `Idempotency-Key` header required on order creation, payment create/cancel/refund, settlement, and all courier delivery actions. Same key + same payload returns the stored response with `"status":"replayed"`; same key + different payload → 409 |
| Pagination            | `page`, `limit` (maximum 50); responses carry `items`, `page`, `limit`, `total`                                                                                                                                                                     |
| Errors                | `{ "error": { "code", "message", "traceId", "details?" } }`; codes are an enumerated list in `@djafat/types`                                                                                                                                        |
| Not yours = not found | Reading another tenant's order, delivery or address returns 404, not 403, so existence is not revealed                                                                                                                                              |

Status codes in use: 200, 201, 202 (OTP sent), 204, 400 (malformed identifier or JSON), 401, 403,
404, 409 (state conflict, idempotency conflict, business rule), 422 (validation), 423 (phone
locked), 428 (MFA step-up required), 429.

## 2. Routes

95 routes; 13 are public. **A route is public unless it carries a guard decorator — there is no
global guard.** "resource owner" means the guard compares the resource's owner with the caller.

### System

| Method | Path                | Who may call |
| ------ | ------------------- | ------------ |
| GET    | `/v1/health`        | **public**   |
| GET    | `/v1/ready`         | **public**   |
| GET    | `/v1/config/public` | **public**   |

### Authentication

| Method | Path                   | Who may call                       |
| ------ | ---------------------- | ---------------------------------- |
| POST   | `/v1/auth/otp/request` | **public**                         |
| POST   | `/v1/auth/otp/verify`  | **public**                         |
| POST   | `/v1/auth/refresh`     | **public**                         |
| POST   | `/v1/auth/logout`      | any signed-in user                 |
| POST   | `/v1/auth/logout-all`  | any signed-in user                 |
| POST   | `/v1/auth/mfa/setup`   | role: admin, super_admin           |
| POST   | `/v1/auth/mfa/verify`  | role: admin, super_admin           |
| POST   | `/v1/auth/mfa/disable` | step-up · role: admin, super_admin |
| GET    | `/v1/me`               | any signed-in user                 |

### Customer addresses

| Method | Path                                 | Who may call   |
| ------ | ------------------------------------ | -------------- |
| GET    | `/v1/users/me/addresses`             | role: customer |
| GET    | `/v1/users/me/addresses/:id`         | role: customer |
| POST   | `/v1/users/me/addresses`             | role: customer |
| PATCH  | `/v1/users/me/addresses/:id`         | role: customer |
| POST   | `/v1/users/me/addresses/:id/default` | role: customer |
| DELETE | `/v1/users/me/addresses/:id`         | role: customer |

### Catalog — public

| Method | Path                         | Who may call |
| ------ | ---------------------------- | ------------ |
| GET    | `/v1/restaurants`            | **public**   |
| GET    | `/v1/restaurants/:slug`      | **public**   |
| GET    | `/v1/restaurants/:slug/menu` | **public**   |
| GET    | `/v1/products/:id`           | **public**   |
| GET    | `/v1/categories`             | **public**   |

### Catalog and restaurant management

| Method | Path                             | Who may call                             |
| ------ | -------------------------------- | ---------------------------------------- |
| GET    | `/v1/restaurants/me/balance`     | role: restaurant_owner, restaurant_staff |
| GET    | `/v1/restaurants/me`             | role: restaurant_owner, restaurant_staff |
| GET    | `/v1/restaurants/me/menu`        | role: restaurant_owner, restaurant_staff |
| PUT    | `/v1/restaurants/me/hours`       | permission: restaurants:write            |
| POST   | `/v1/restaurants`                | permission: restaurants:write            |
| PATCH  | `/v1/restaurants/:id`            | permission: restaurants:write            |
| POST   | `/v1/restaurants/:id/categories` | permission: menus:write                  |
| PATCH  | `/v1/categories/:id`             | permission: menus:write                  |
| POST   | `/v1/restaurants/:id/products`   | permission: menus:write                  |
| PATCH  | `/v1/products/:id`               | permission: menus:write                  |
| PATCH  | `/v1/products/:id/availability`  | permission: menus:write                  |
| POST   | `/v1/products/:id/option-groups` | permission: menus:write                  |
| PATCH  | `/v1/option-groups/:id`          | permission: menus:write                  |

### Carts

| Method | Path                      | Who may call   |
| ------ | ------------------------- | -------------- |
| GET    | `/v1/carts`               | role: customer |
| POST   | `/v1/carts/items`         | role: customer |
| PATCH  | `/v1/carts/items/:itemId` | role: customer |
| DELETE | `/v1/carts/items/:itemId` | role: customer |
| DELETE | `/v1/carts`               | role: customer |
| POST   | `/v1/carts/quote`         | role: customer |

### Orders

| Method | Path                     | Who may call                                                                              |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| POST   | `/v1/orders`             | role: customer                                                                            |
| GET    | `/v1/orders`             | role: restaurant_owner, restaurant_staff                                                  |
| GET    | `/v1/orders/mine`        | role: customer                                                                            |
| GET    | `/v1/orders/:id`         | customer who owns it, member of its restaurant, its assigned courier, or staff — else 404 |
| POST   | `/v1/orders/:id/confirm` | role: restaurant_owner, restaurant_staff                                                  |
| POST   | `/v1/orders/:id/ready`   | role: restaurant_owner, restaurant_staff                                                  |
| POST   | `/v1/orders/:id/reject`  | role: restaurant_owner, restaurant_staff                                                  |

### Payments

| Method | Path                             | Who may call                                                              |
| ------ | -------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/v1/config/payment-methods`     | **public**                                                                |
| POST   | `/v1/payments`                   | role: customer                                                            |
| GET    | `/v1/payments/:id`               | resource owner, or staff with payments:read                               |
| POST   | `/v1/payments/:id/cancel`        | resource owner, or staff with payments:write                              |
| POST   | `/v1/payments/:id/refund`        | step-up · role: admin, super_admin, finance · permission: payments:refund |
| POST   | `/v1/payments/webhook/:provider` | **public**                                                                |

### Deliveries and couriers

| Method | Path                         | Who may call                                                     |
| ------ | ---------------------------- | ---------------------------------------------------------------- |
| GET    | `/v1/couriers/me`            | role: courier                                                    |
| GET    | `/v1/couriers/me/balance`    | role: courier                                                    |
| POST   | `/v1/couriers/me/status`     | role: courier                                                    |
| POST   | `/v1/couriers/me/location`   | role: courier                                                    |
| POST   | `/v1/deliveries/:id/accept`  | courier holding the live offer                                   |
| POST   | `/v1/deliveries/:id/reject`  | courier holding the live offer                                   |
| POST   | `/v1/deliveries/:id/pickup`  | assigned courier                                                 |
| POST   | `/v1/deliveries/:id/deliver` | assigned courier, with the customer's code                       |
| POST   | `/v1/deliveries/:id/fail`    | assigned courier or staff (checked in the service)               |
| GET    | `/v1/couriers/me/offers`     | role: courier                                                    |
| GET    | `/v1/couriers/me/deliveries` | role: courier                                                    |
| GET    | `/v1/deliveries/:id`         | assigned courier, owning customer, or staff — else 404           |
| GET    | `/v1/deliveries/:id/code`    | role: customer, and owner of the order — else 404                |
| POST   | `/v1/deliveries/:id/cancel`  | owning customer or staff (checked in the service)                |
| POST   | `/v1/deliveries`             | role: admin, super_admin, support · permission: deliveries:write |

### Notifications

| Method | Path                             | Who may call       |
| ------ | -------------------------------- | ------------------ |
| GET    | `/v1/notifications`              | any signed-in user |
| GET    | `/v1/notifications/unread-count` | any signed-in user |
| POST   | `/v1/notifications/:id/read`     | any signed-in user |
| GET    | `/v1/notifications/devices`      | any signed-in user |
| POST   | `/v1/notifications/devices`      | any signed-in user |
| DELETE | `/v1/notifications/devices/:id`  | any signed-in user |

### Back office

| Method | Path                                   | Who may call                                                               |
| ------ | -------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/v1/admin/ping`                       | role: admin, super_admin                                                   |
| POST   | `/v1/admin/sensitive-ping`             | step-up · role: admin, super_admin · permission: admin:write               |
| GET    | `/v1/admin/users`                      | role: admin, super_admin, support · permission: users:read                 |
| GET    | `/v1/admin/users/:id`                  | role: admin, super_admin, support · permission: users:read                 |
| POST   | `/v1/admin/users/:id/roles`            | step-up (admin roles) · role: admin, super_admin · permission: users:write |
| DELETE | `/v1/admin/users/:id/roles/:role`      | step-up (admin roles) · role: admin, super_admin · permission: users:write |
| POST   | `/v1/admin/users/:id/suspend`          | role: admin, super_admin · permission: users:write                         |
| POST   | `/v1/admin/users/:id/block`            | role: admin, super_admin · permission: users:write                         |
| POST   | `/v1/admin/users/:id/reactivate`       | role: admin, super_admin · permission: users:write                         |
| GET    | `/v1/admin/restaurants`                | role: admin, super_admin · permission: restaurants:read                    |
| GET    | `/v1/admin/restaurants/:id/balance`    | role: admin, super_admin, finance · permission: ledger:read                |
| GET    | `/v1/admin/couriers`                   | role: admin, super_admin, support · permission: couriers:read              |
| GET    | `/v1/admin/couriers/:userId/balance`   | role: admin, super_admin, finance · permission: ledger:read                |
| POST   | `/v1/admin/couriers/:userId/suspend`   | role: admin, super_admin, support · permission: couriers:write             |
| POST   | `/v1/admin/couriers/:userId/reinstate` | role: admin, super_admin, support · permission: couriers:write             |
| GET    | `/v1/admin/finance/balances`           | role: admin, super_admin, finance · permission: ledger:read                |
| GET    | `/v1/admin/orders`                     | role: admin, super_admin, support · permission: orders:read                |
| GET    | `/v1/admin/settlements`                | role: admin, super_admin, finance · permission: ledger:read                |
| POST   | `/v1/admin/settlements`                | step-up · role: admin, super_admin, finance · permission: payouts:write    |

### Permission matrix

21 permissions, granted to roles by the seed (`apps/api/prisma/seed.ts`). `customer` holds none:
customer routes are protected by role and ownership.

| Role                   | Permissions                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `restaurant_owner`     | restaurants:read, restaurants:write, menus:read, menus:write, orders:read                             |
| `restaurant_staff`     | restaurants:read, menus:read, menus:write, orders:read                                                |
| `courier`              | deliveries:read, deliveries:write, orders:read                                                        |
| `support`              | users:read, orders:read, payments:read, deliveries:read, couriers:read, couriers:write                |
| `finance`              | payments:read, payments:write, payments:refund, ledger:read, payouts:read, payouts:write, orders:read |
| `admin`, `super_admin` | the operational set — see the seed for the exact list                                                 |

Holding a permission is never enough to cross tenants: staff-wide access additionally requires one
of the four staff roles (`common/authz/staff-tier.ts`).

### Routes that do not exist but the product needs

| Missing                                                                          | Finding                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cancel an order (customer, staff)                                                | [`ORD-01`](FINDINGS.md#ord-01)                                 |
| Update own profile, change phone, delete account                                 | [`AUTH-02`](FINDINGS.md#auth-02)                               |
| Request or execute a payout                                                      | [`PAY-06`](FINDINGS.md#pay-06)                                 |
| Upload a file                                                                    | [`STOR-01`](FINDINGS.md#stor-01)                               |
| Re-issue a delivery code or force-complete a delivery                            | [`DLV-02`](FINDINGS.md#dlv-02)                                 |
| Activate a restaurant, set its coordinates, onboard a courier                    | [`DLV-01`](FINDINGS.md#dlv-01), [`ADM-03`](FINDINGS.md#adm-03) |
| Manage platform settings, commission rules, payment configuration, feature flags | seed or SQL only                                               |
| Reviews, favourites, promotions                                                  | not in first-release scope                                     |

## 3. Realtime

Socket.IO, namespace `/rt`, token in `auth.token` at handshake. Verified live on one instance.

| Client sends             | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `subscribe` `{ room }`   | Join a room if entitled. No acknowledgement is returned ([`RT-01`](FINDINGS.md#rt-01)) |
| `unsubscribe` `{ room }` | Leave                                                                                  |

| Room                               | Who may join                                          |
| ---------------------------------- | ----------------------------------------------------- |
| `order:{orderId}`                  | the customer who owns it, its assigned courier, staff |
| `courier:{userId}`                 | that courier, staff                                   |
| `restaurant:orders:{restaurantId}` | members of that restaurant, staff                     |
| `admin:ops`                        | staff                                                 |

Server events are named after domain events (`order.confirmed`, `delivery.assigned`,
`payment.succeeded`, …) and carry `{ eventId, eventType, aggregateId, occurredAt, orderId?,
deliveryId?, status? }`. They are a signal to refetch, never the data. `courier.offer.new` is
pushed directly to the courier's room. Sockets are disconnected when their token expires.

## 4. Integrations

| Integration             | Interface in code                                             | Implementations                                    | State                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP delivery            | `OtpDeliveryPort`                                             | mock (code readable in Redis, non-production only) | **Not Implemented** for real use — [`AUTH-01`](FINDINGS.md#auth-01)                                                                         |
| Payments                | `PaymentProvider` + registry                                  | `cash`, `mock`                                     | Cash broken, mock unsafe, no real provider — [`PAY-02`](FINDINGS.md#pay-02), [`PAY-01`](FINDINGS.md#pay-01), [`PAY-07`](FINDINGS.md#pay-07) |
| Payment webhooks        | `POST /v1/payments/webhook/:provider`, HMAC over the raw body | mock                                               | Ordering defect — [`PAY-05`](FINDINGS.md#pay-05)                                                                                            |
| Push notifications      | `PushPort`                                                    | mock                                               | Not Implemented — [`NOTIF-01`](FINDINGS.md#notif-01)                                                                                        |
| Object storage          | `ObjectStoragePort`                                           | stub that rejects every call                       | Not Implemented — [`STOR-01`](FINDINGS.md#stor-01)                                                                                          |
| Maps and geocoding      | — (`geo` module is empty)                                     | none                                               | Not Implemented — [`DLV-01`](FINDINGS.md#dlv-01)                                                                                            |
| Email                   | —                                                             | none (Mailpit container is unused)                 | Not Implemented                                                                                                                             |
| Error tracking, tracing | environment variables only                                    | none                                               | Not Implemented — [`OBS-01`](FINDINGS.md#obs-01)                                                                                            |

The adapter pattern is in place for the first four; adding a real provider is an isolated change.

## 5. API-level findings

[`PAY-01`](FINDINGS.md#pay-01) · [`PAY-03`](FINDINGS.md#pay-03) · [`PAY-05`](FINDINGS.md#pay-05) ·
[`ORD-01`](FINDINGS.md#ord-01) · [`ORD-03`](FINDINGS.md#ord-03) · [`ORD-04`](FINDINGS.md#ord-04) ·
[`SEC-03`](FINDINGS.md#sec-03) · [`SEC-04`](FINDINGS.md#sec-04) · [`SEC-06`](FINDINGS.md#sec-06) ·
[`OPS-03`](FINDINGS.md#ops-03) · [`API-01`](FINDINGS.md#api-01) · [`OBS-01`](FINDINGS.md#obs-01).

## 6. Keeping this page current

The route tables are derived, not hand-written. After adding or changing a controller, regenerate
them by listing each handler's HTTP decorator and its `Require*` decorators (the audit used a
50-line script over `apps/api/src/**/*.controller.ts`), and update the count in §2. A generated
OpenAPI document checked into the repository would remove this step.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
