# Module: delivery and dispatch

`apps/api/src/modules/deliveries` and `modules/couriers`, the delivery state machine in
`packages/core`, and the retry job in `apps/worker`. Design intent:
`docs/09-livraison-geo-temps-reel.md`, `docs/25-bloc-6-delivery-dispatch.md`.

**State: Completed for the main path; Partially Completed around it.** A delivery was dispatched,
accepted, picked up and completed with the customer's code against a real database. The gaps are
operational: location capture, the courier's device, and what happens when the code step goes wrong.

## 1. How it works

**Courier state.** One row per courier: `offline`, `online`, `busy`, `suspended`; last position
with accuracy and time; the delivery currently held. Position updates are checked for plausible
coordinates, accuracy (≤ 500 m), speed and clock skew.

**Dispatch.** When an order becomes `ready`, a delivery is created with the restaurant's
coordinates and moves to `searching_courier`. A wave selects couriers who are online, free,
positioned within the last 120 seconds and within the current radius (3 km, +2 km per empty wave,
up to 8 km), nearest first, excluding those who refused and those whose offer just expired. The
first one that can be claimed under lock receives an offer valid for 30 seconds; the delivery shows
`courier_assigned`. The worker expires stale offers and runs further waves every 10 seconds. All
figures are platform settings.

**Concurrency.** Delivery row locked first, courier row second, everywhere. Three partial unique
indexes back this up: one active delivery per courier, one courier per active delivery, one live
offer per delivery. A lost race surfaces as "no offer this wave", not an error.

**Accept / refuse.** Accepting checks the offer is live and addressed to the caller, the delivery
state, and that the courier is still eligible; it also moves the pooled courier fee to that
courier in the ledger. Refusing frees the courier and starts the next wave at once.

**Pickup.** One call moves the delivery to `on_the_way` and issues a 4-digit code — stored as a
hash for verification and, encrypted with its own key, so the customer can read it back.

**Proof and completion.** The courier submits the code. Authorisation is checked before the code;
five wrong attempts lock it; it expires after four hours; it is consumed in the same transaction
that marks the delivery delivered, releases funds in the ledger and frees the courier.

**Cancel and fail.** The owning customer or staff may cancel within the states the state machine
allows; the assigned courier or staff may report failure. Both free the courier and lead the order
to `cancelled`.

Tables: `couriers`, `deliveries`, `delivery_offers`, `delivery_proofs`.

## 2. Features

| Feature                                                       | State                 | Evidence                                                                                                                         |
| ------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Courier online/offline; cannot go offline mid-delivery        | Completed             | LIVE (online); CODE (offline rule)                                                                                               |
| Position update with validation                               | Completed             | LIVE                                                                                                                             |
| Delivery created when the order is ready                      | Completed, fragile    | LIVE; in-process event ([`ARCH-01`](../FINDINGS.md#arch-01))                                                                     |
| Nearest-courier offer with rich context                       | Completed             | LIVE (restaurant, drop-off landmark, fee)                                                                                        |
| Offer expiry, radius widening, retry                          | Implemented           | CODE + worker unit tests. Not isolated in the live run: the courier was eligible at once, so the API's first wave made the offer |
| Accept, with ledger reclassification                          | Completed             | LIVE                                                                                                                             |
| Refuse                                                        | Implemented           | CODE + unit tests; not exercised live                                                                                            |
| Pickup and code issue                                         | Completed, not atomic | LIVE; [`DLV-03`](../FINDINGS.md#dlv-03)                                                                                          |
| Customer reads the code; courier cannot                       | Completed             | LIVE                                                                                                                             |
| Wrong code refused and counted                                | Completed             | LIVE                                                                                                                             |
| Delivered: funds released, courier freed, order closed        | Completed             | LIVE                                                                                                                             |
| Isolation between couriers and between customers              | Completed             | LIVE                                                                                                                             |
| Customer cancels a delivery                                   | Implemented           | LIVE for refusal of a stranger; own cancellation not exercised                                                                   |
| Report failure                                                | Implemented           | CODE + unit tests                                                                                                                |
| Manual dispatch by staff (`POST /deliveries`)                 | Implemented           | Role wall LIVE; action not exercised                                                                                             |
| Suspend / reinstate a courier                                 | Completed             | CODE; role wall LIVE                                                                                                             |
| **Pickup coordinates for restaurants created in the product** | **Not Implemented**   | LIVE — [`DLV-01`](../FINDINGS.md#dlv-01)                                                                                         |
| **Re-issue a code or complete a locked delivery**             | **Not Implemented**   | [`DLV-02`](../FINDINGS.md#dlv-02)                                                                                                |
| Refund or compensation when a delivery fails or is cancelled  | Not Implemented       | [`PAY-04`](../FINDINGS.md#pay-04)                                                                                                |
| Cash collection at the door                                   | Not Implemented       | [`PAY-02`](../FINDINGS.md#pay-02)                                                                                                |
| Background location, push for offers                          | Not Implemented       | [`COUR-01`](../FINDINGS.md#cour-01)                                                                                              |
| Live courier position for the customer                        | Not Implemented       | Deferred by design                                                                                                               |
| Estimated time of arrival, routing                            | Not Implemented       | Straight-line distance only                                                                                                      |
| Batching, zones, courier ratings or priorities                | Not Implemented       |                                                                                                                                  |
| Alert when nobody can be found                                | Partially Completed   | An event reaches the staff room; no console listens to it                                                                        |
| Proof by photo or signature                                   | Not Implemented       | Types exist in the schema                                                                                                        |

## 3. Assessment

**Strong:** the invariants that matter are enforced twice — by locking and by the database; the
proof step was thought through against a dishonest courier (code never returned to them, verified
after authorisation, single use, rate-limited); authorisation was tightened after an earlier
family of cross-tenant defects and now sits in one shared rule (`common/authz/order-access.ts`).

**Weak:**

- **Field conditions.** One courier at a time for 30 seconds, announced only inside an open app,
  eligible only with a position under two minutes old, sent only in the foreground. In practice
  offers will expire unseen.
- **No coordinates, no dispatch.** A delivery without pickup coordinates stays "searching" for
  ever; an event is emitted that nothing displays.
- **Five wrong codes end the delivery.** The message says to contact support; support has no tool.
- **Two implementations of dispatch** ([`ARCH-02`](../FINDINGS.md#arch-02)).
- **Pickup is four separate writes**; a retry after a partial failure returns "already picked up"
  without a code ([`DLV-03`](../FINDINGS.md#dlv-03)).
- **The 4-digit code is drawn with a slight modulo bias** (`readUInt16BE % 10000`) — immaterial
  given the attempt limit, trivially fixed with `randomInt`.
- **`deliveries.service.ts` is 1 474 lines.**

## 4. Findings and tasks

`DLV-01` → T-212 · `COUR-01` → T-211 · `DLV-02`, `DLV-03` → T-311 · `ARCH-02` → T-401 ·
`ARCH-01` → T-301 · `MOB-01` → T-210 · `PAY-02` → T-202.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
