# Module: cart, orders and pricing

`apps/api/src/modules/carts`, `modules/orders`, `modules/pricing`, with the order state machine and
cart pricing in `packages/core`. Design intent: `docs/22-bloc-4-cart-order.md`,
`docs/23-bloc-4-qa-adversarial.md`.

**State: Partially Completed.** Building a cart and creating an order are solid. Everything that
happens when an order does not go to plan is missing.

## 1. How it works

**Cart.** One open cart per customer, bound to one restaurant and currency by its first item
(adding from another restaurant is refused unless `replaceCart` is sent). A line stores a display
snapshot of name and price; these are never trusted for charging. Quantity 1–99.

**Quote.** `POST /carts/quote` re-reads live prices and options and returns lines, subtotal,
delivery fee and total.

**Order creation** (`POST /orders`, idempotent), in one transaction:

1. Lock the open cart; re-validate every product and option against the live catalog.
2. Refuse if the restaurant is not `OPEN` right now (`RESTAURANT_CLOSED`).
3. Resolve the delivery address — the one named, which must belong to the caller, or the default —
   and copy it onto the order.
4. Price it: subtotal, flat delivery fee, commission from `commission_rules`
   (restaurant → city → country → global), courier fee equal to the delivery fee.
5. Insert the order as `awaiting_payment` with a 15-minute deadline, its lines and options, a
   history row and an outbox event; mark the cart converted.

**Lifecycle.** All transitions go through `transitionOrder`, which locks the row, checks the
caller's membership of the order's restaurant when a person acts, validates against the state
machine, writes history and an outbox event, then emits an in-process event.

| Transition                                | Triggered by                                    |
| ----------------------------------------- | ----------------------------------------------- |
| `awaiting_payment → placed`               | payment succeeded (in-process event)            |
| `awaiting_payment → expired`              | worker, after 15 minutes                        |
| `placed → confirmed`, `placed → rejected` | restaurant                                      |
| `confirmed → preparing → ready`           | restaurant, one call                            |
| `ready → courier_assigned`                | courier accepted (in-process event)             |
| `→ picked_up → on_the_way → delivered`    | delivery events (in-process)                    |
| `→ cancelled`                             | delivery cancelled or failed (in-process event) |

Tables: `carts`, `cart_items`, `cart_item_options`, `orders`, `order_items`, `order_item_options`,
`order_status_history`, `commission_rules`, `platform_settings`.

## 2. Features

| Feature                                             | State               | Evidence                                           |
| --------------------------------------------------- | ------------------- | -------------------------------------------------- |
| Add, update, remove, clear; one restaurant per cart | Completed           | LIVE                                               |
| Required-option validation                          | Completed           | LIVE (422 without the choice)                      |
| Quote with live prices                              | Completed           | LIVE                                               |
| Idempotent order creation                           | Completed           | LIVE (replay returned the same order; one row)     |
| Protection against double submission with two keys  | Completed           | LIVE (second → `CART_EMPTY`)                       |
| Refuse when the restaurant is closed                | Completed           | CODE + unit tests; listed as fixed in `docs/36`    |
| Address snapshot independent of later edits         | Completed           | CODE; ownership of the chosen address LIVE         |
| Commission resolution and snapshot                  | Completed           | LIVE (20 % country rule applied)                   |
| Order expiry                                        | Completed           | LIVE                                               |
| Restaurant board, confirm, ready, reject            | Completed           | LIVE                                               |
| Customer order history (API)                        | Completed           | LIVE                                               |
| Admin order list                                    | Completed           | LIVE (console)                                     |
| Tenant-scoped read of one order                     | Completed           | LIVE                                               |
| **Minimum order**                                   | **Broken**          | LIVE — [`ORD-03`](../FINDINGS.md#ord-03)           |
| **Cancel by customer or staff**                     | **Not Implemented** | LIVE — [`ORD-01`](../FINDINGS.md#ord-01)           |
| **Time-out when the restaurant does not answer**    | **Not Implemented** | LIVE — [`ORD-02`](../FINDINGS.md#ord-02)           |
| **Cash orders**                                     | **Broken**          | LIVE — [`PAY-02`](../FINDINGS.md#pay-02)           |
| Refund on rejection                                 | Not Implemented     | LIVE — [`PAY-04`](../FINDINGS.md#pay-04)           |
| Delivery fee by zone or distance                    | Not Implemented     | Flat 1 000 XAF — [`ORD-05`](../FINDINGS.md#ord-05) |
| Taxes, service fee, promotions, tips                | Not Implemented     |                                                    |
| Scheduled orders, order notes, re-order             | Not Implemented     |                                                    |
| Edit an order after placing                         | Not Implemented     |                                                    |

## 3. Assessment

**Strong:** the client never supplies a price; the order freezes everything it charged for; the
cart lock closes the double-order race that idempotency alone leaves open; the availability check
uses the same function as the catalog; every transition is validated by one table and recorded.

**Weak:**

- **The state machine knows more than the API offers.** Cash placement and three kinds of
  cancellation are modelled and unreachable.
- **Reactions to payment and delivery arrive over a channel that can lose them**
  ([`ARCH-01`](../FINDINGS.md#arch-01)). `markPlacedFromPayment` also writes its three rows outside
  a transaction. A paid order whose reaction is lost is then _expired_ by the worker.
- **No path out of a stuck order**: unanswered, uncancellable, no staff action.
- **Two-step reactions are not atomic** (`picked_up` then `on_the_way`; `delivered` then the
  timestamp): a failure between them leaves the order one state behind its delivery.
- **`orders.service.ts` is 1 169 lines** and implements three ports, six event handlers and three
  listings alongside creation.
- **Customer history rows carry a restaurant ID, not a name**, so a client must fetch each restaurant.

## 4. Findings and tasks

`PAY-02` · `ORD-01` · `ORD-02` · `ORD-03` · `ORD-05` · `ARCH-01` · `PAY-04` → T-202, T-204, T-205,
T-206, T-209, T-301, T-504.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
