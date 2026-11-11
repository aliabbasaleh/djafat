# Shared packages

Ten workspace packages under `packages/`. They are what makes five client applications and two
backend processes speak one language. All build with `tsc` to CommonJS and are consumed through
workspace links.

| Package                                     | State                              | Lines | Tests |
| ------------------------------------------- | ---------------------------------- | ----- | ----- |
| `@djafat/types`                             | Completed                          | 830   | —     |
| `@djafat/core`                              | Completed                          | 3 460 | 181   |
| `@djafat/validation`                        | Completed                          | 130   | 4     |
| `@djafat/config`                            | Needs Improvement                  | 320   | 8     |
| `@djafat/sdk`                               | **Broken in browsers**; incomplete | 1 550 | 10    |
| `@djafat/ui`                                | Completed                          | 2 340 | 56    |
| `@djafat/tokens`                            | Completed                          | 85    | 5     |
| `@djafat/i18n`                              | Partially Completed                | 105   | 5     |
| `@djafat/testing`                           | Minimal                            | 55    | 0     |
| `@djafat/tsconfig`, `@djafat/eslint-config` | Completed                          | —     | —     |

## `@djafat/types`

The shared vocabulary: roles, permissions, order/delivery/payment statuses, domain event names and
the outbox envelope, API error codes, money types (`Money` with `bigint`, `MoneyJson` with a
string), and the port interfaces (`PaymentProvider`, `LedgerPort`, `OrderAmountPort`,
`OtpDeliveryPort`, `ObjectStoragePort`, `CourierPort`). No runtime logic. Used everywhere.

## `@djafat/core`

Pure domain logic with no I/O — the best-tested code in the repository (100 % statements, 97 %
branches).

| Area                           | Content                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `money`                        | Construction, arithmetic, comparison, rate application in basis points, JSON conversion, currency registry         |
| `order`, `delivery`, `payment` | State machines as transition tables with the roles allowed for each move                                           |
| `ledger`                       | Validation that an entry group balances per currency, with positive amounts                                        |
| `cart`, `catalog`              | Line and subtotal pricing; option-selection validation; restaurant availability from hours, closures and time zone |
| `auth`, `mfa`                  | OTP attempt policy; refresh-token rotation and reuse decision; TOTP (RFC 6238)                                     |
| `idempotency`                  | Canonical JSON and replay reconciliation                                                                           |
| `geo`                          | Coordinate validation and distance                                                                                 |

Note: the order state machine defines cash-on-delivery placement and customer/admin cancellation.
The API uses neither ([`PAY-02`](../FINDINGS.md#pay-02), [`ORD-01`](../FINDINGS.md#ord-01)) — the
model is ahead of the implementation.

## `@djafat/validation`

Zod schemas shared by the API and the clients: phone number in international format, UUID, money
JSON. Small on purpose; most request schemas live next to their controllers in `apps/api`.

## `@djafat/config`

Environment parsing (`loadApiEnv`, `loadWorkerEnv`) and platform constants: launch market, default
platform settings, header names.

- **Secrets are validated only as non-empty** ([`SEC-01`](../FINDINGS.md#sec-01)).
- A dozen variables are validated and never used; some are required
  ([`../CODE_QUALITY_AUDIT.md`](../CODE_QUALITY_AUDIT.md) §3.6).
- Its own test file contains the two base64 test keys that the secret scanner flags
  ([`CI-01`](../FINDINGS.md#ci-01)).

## `@djafat/sdk`

The typed HTTP client used by all five client applications. `createApiClient({ baseUrl,
getAccessToken })` returns `http` plus bindings grouped by domain.

| Binding      | Covers                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------- |
| `catalog`    | restaurants, restaurant, menu, product, categories                                        |
| `cart`       | get, add, update, remove, clear, quote                                                    |
| `addresses`  | list, create, update, remove, set default                                                 |
| `orders`     | create, get, list mine                                                                    |
| `restaurant` | own restaurant, menu, products, categories, hours, orders, balance                        |
| `courier`    | profile, status, location, offers, deliveries, accept/reject/pickup/deliver/fail, balance |
| `admin`      | users, roles, restaurants, couriers, orders, finance, settlements                         |

**Defects and gaps**

- **Calls fail in every browser** — `fetch` is invoked detached from `window`
  ([`SDK-01`](../FINDINGS.md#sdk-01)). Node-based tests cannot see it.
- **No binding for** payments, delivery code, notifications, authentication (login pages call
  `http.post` directly), refunds ([`FE-01`](../FINDINGS.md#fe-01), [`FE-03`](../FINDINGS.md#fe-03),
  [`NOTIF-01`](../FINDINGS.md#notif-01)).
- **No token refresh and no retry**; each application handles a 401 by redirecting to login
  ([`FE-02`](../FINDINGS.md#fe-02)).
- Good: sets `Content-Type` only when there is a body; maps the API's error envelope to a typed
  `ApiClientError`; passes idempotency keys.

Session storage and the realtime client are **not** in the SDK; each application carries its own
copy. Moving them here is the natural home for the token-refresh work.

## `@djafat/ui`

The React design system for the three web applications: primitives (`Container`, `Stack`, `Text`,
`Heading`), form controls, buttons, alerts, badges, cards, navigation and layout components, with
CSS modules driven by the tokens. 56 component tests with Testing Library. It depends on `next`
(for links and images), so it is specific to the Next.js apps. The phone apps have their own small
component sets.

## `@djafat/tokens`

Colours, spacing, radii and type scale as a JSON file and typed exports, consumed by `@djafat/ui`
and by both Expo apps. This is what keeps web and mobile visually aligned without sharing components.

## `@djafat/i18n`

A small translation helper and a French locale. Imported by five files; most interface text is
written inline in the pages ([`I18N-01`](../FINDINGS.md#i18n-01)).

## `@djafat/testing`

A few shared fixtures. The heavy test doubles live inside `apps/api` instead
([`TEST-02`](../FINDINGS.md#test-02)).

## `@djafat/tsconfig`, `@djafat/eslint-config`

Compiler presets for libraries, Nest, Next and React Native; ESLint flat configurations, including
`api-boundaries.js`, which encodes the module dependency rules that keep `orders` from importing
`payments`. These work: lint is clean and the boundaries hold.

## Outstanding tasks

T-101 (SDK `fetch`) · T-104 (secret validation) · T-201, T-208 (SDK payments and delivery code) ·
T-207 (refresh, shared session and realtime client) · T-404 (unused configuration) · T-505
(translations).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
