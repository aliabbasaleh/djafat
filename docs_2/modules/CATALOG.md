# Module: catalog and addresses

`apps/api/src/modules/catalog` (restaurants, menus, options, hours) and `modules/addresses`
(customer address book), with availability and option rules in `packages/core/src/catalog`.
Design intent: `docs/20-bloc-2-catalog.md`, `docs/29-bloc-8-customer-address-checkout.md`.

**State: Completed for browsing and editing; Not Implemented for location and media.**

## 1. How it works

- **Public reads** (no login): restaurant list with search, "open now", sort and pagination;
  restaurant by slug; menu; product with option groups; category list with counts.
- **Search** uses PostgreSQL full-text search (French configuration) on generated columns of
  `restaurants` and `products`.
- **Availability** is computed, not stored: `OPEN`, `CLOSED`, `PAUSED` or `UNAVAILABLE` from the
  restaurant's status, weekly hours, exceptional closures and its city's time zone
  (`core/catalog/restaurant-availability.ts`, 17 tests). The same function gates order creation.
- **Options**: a product has option groups (single or multiple choice, minimum and maximum,
  required or not); each option adds or subtracts a price difference. Selections are validated by
  `core/catalog/product-option-validator.ts`.
- **Management**: routes guarded by `restaurants:write` and `menus:write`; the service then checks
  that the caller belongs to the restaurant concerned (or is staff).
- **Restaurant lifecycle**: `draft → pending_review → active ⇄ paused`, `suspended`, `closed`.
- **Addresses**: per customer; landmark-first (district, street, landmark, instructions,
  recipient phone); optional coordinates; one default enforced by the database.

Tables: `restaurants`, `menu_categories`, `products`, `product_option_groups`, `product_options`,
`restaurant_hours`, `restaurant_closures`, `addresses`, `cities`.

## 2. Features

| Feature                                                      | State                          | Evidence                                                                                   |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| List, search, filter, sort, paginate restaurants             | Completed                      | LIVE; open restaurants first under every sort, closed ones dimmed (RUN, merged in S-060)   |
| Restaurant page, menu, product, categories                   | Completed                      | LIVE                                                                                       |
| Availability from hours and time zone                        | Completed                      | LIVE (open, closed and paused restaurants shown correctly)                                 |
| Unknown slug → 404; malformed identifier → 400               | Completed                      | LIVE                                                                                       |
| Edit own restaurant profile                                  | Completed                      | LIVE (cross-restaurant edit refused)                                                       |
| Replace opening hours                                        | Completed                      | CODE; owner only by permission (staff → 403, LIVE)                                         |
| Create and edit categories and products; availability switch | Completed                      | LIVE for refusal across restaurants; console screens seen                                  |
| Create and edit option groups                                | Implemented                    | CODE; not exercised                                                                        |
| Exceptional closures                                         | Partially Completed            | Table and availability logic exist; no route to manage them was found — Needs Verification |
| Create a restaurant                                          | Completed, questionable access | LIVE — an owner can create one ([`ORD-04`](../FINDINGS.md#ord-04))                         |
| **Set a restaurant's coordinates**                           | **Not Implemented**            | LIVE — created restaurant has none ([`DLV-01`](../FINDINGS.md#dlv-01))                     |
| Activate, suspend or close a restaurant (workflow, screen)   | Partially Completed            | Status can be patched through the API within limits; no console screen                     |
| Upload logo, cover, product photos                           | Not Implemented                | URL text fields ([`STOR-01`](../FINDINGS.md#stor-01))                                      |
| Ratings                                                      | Not Implemented                | `rating_avg`/`rating_count` columns hold seed values; no review feature                    |
| Delivery zones                                               | Not Implemented                | No table                                                                                   |
| Address book: list, create, update, delete, default          | Completed                      | LIVE (isolation verified)                                                                  |
| Geocoding an address; map picker                             | Not Implemented                | `geo` module is empty; coordinates only if the client sends them                           |
| Admin list of restaurants with balances                      | Completed                      | LIVE (console)                                                                             |

## 3. Assessment

**Strong:** availability has one definition used for both display and order acceptance; option
validation is strict (a required group missing → 422, verified); list queries avoid per-row
lookups; tenant checks sit in the service, where a wrong route decorator cannot bypass them.

**Weak:**

- **Location is the missing foundation.** Dispatch needs the restaurant's coordinates and the
  customer's; neither can be captured by a person. The seeded data has them by SQL. Every
  restaurant onboarded through the product would be undeliverable.
- **Onboarding is not a flow.** A restaurant is created as a draft by an API call, has no way to
  submit for review, and no screen exists to activate it.
- **Images are whatever URL someone typed**, fetched through the image optimiser from a single
  allowed host.
- **Displayed minimum order and preparation time are informational only**
  ([`ORD-03`](../FINDINGS.md#ord-03)).
- **The menu endpoint omits option groups**; clients must fetch each product to learn that a choice
  is required. Acceptable, but it costs a request per product on slow networks.

## 4. Findings and tasks

`DLV-01` · `ORD-04` · `STOR-01` · `ORD-03` → T-212, T-312, T-503, T-209.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
