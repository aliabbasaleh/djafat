# Module: realtime and notifications

`apps/api/src/modules/realtime` and `modules/notifications`, fed by the worker's `outbox-relay`
job. Design intent: `docs/27-bloc-7-realtime-notifications.md`, `docs/28-bloc-7.1-realtime-hardening.md`.

**State: realtime Completed on one instance; notifications Partially Completed** — stored
server-side, never shown and never pushed.

## 1. How it works

```text
business transaction ──► outbox row ──► worker (every 2 s) ──► Redis stream
                                                                   │
                                          API consumer group ◄─────┘
                                           ├─► realtime gateway ─► socket rooms
                                           └─► notifications listener ─► notifications table (─► push port)
```

- **Outbox.** Every state change writes an event row in the same transaction as the change.
- **Relay.** The worker appends pending rows to a capped Redis stream and marks them published,
  with exponential back-off on failure.
- **Consumer.** Each API instance reads the stream in a consumer group, hands each event to the
  in-process listeners, and acknowledges only when they have finished; entries left pending by a
  dead consumer are reclaimed.
- **Routing.** A pure table (`domain-event-router.ts`) decides which kinds of room may receive
  each event type. Unknown events go nowhere.
- **Gateway.** Socket.IO namespace `/rt`. The token is verified in connection middleware; each
  `subscribe` is authorised per room; a periodic sweep disconnects sockets whose token expired.
  Payloads are identifiers and a status only.
- **Notifications.** A listener turns selected events into rows keyed by user and source event
  (so redelivery cannot duplicate), with translation keys rather than text, and calls a push port.

Rooms and who may join them: [`../API_AND_INTEGRATIONS.md`](../API_AND_INTEGRATIONS.md) §3.

## 2. Features

| Feature                                                                         | State               | Evidence                                                                     |
| ------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Outbox written with each change                                                 | Completed           | LIVE (40 rows, all published)                                                |
| Relay to the stream with retry                                                  | Completed           | LIVE                                                                         |
| Stream consumer with acknowledgement and reclaim                                | Completed           | LIVE for delivery; reclaim by unit tests                                     |
| Reject unauthenticated or badly signed sockets                                  | Completed           | LIVE                                                                         |
| Room authorisation (order, restaurant, courier, staff)                          | Completed           | LIVE — five cases                                                            |
| Event reaches the customer's and the restaurant's rooms after a real transition | Completed           | LIVE (`order.confirmed`, within a few seconds)                               |
| A stranger receives nothing                                                     | Completed           | LIVE                                                                         |
| Disconnect on token expiry                                                      | Implemented         | CODE + unit tests                                                            |
| Direct "new offer" push to a courier's room                                     | Implemented         | CODE; offers were read by polling in the live run                            |
| Fan-out across several API instances                                            | Needs Verification  | Redis adapter attached; never run with two ([`RT-01`](../FINDINGS.md#rt-01)) |
| Acknowledge or refuse a subscription to the client                              | Not Implemented     | A refused join is silent                                                     |
| Notification rows created from events                                           | Completed           | LIVE (9 rows)                                                                |
| List, unread count, mark read (API)                                             | Implemented         | CODE; no client calls them                                                   |
| Register a device for push (API)                                                | Implemented         | CODE; no client calls it                                                     |
| **Show notifications in any application**                                       | **Not Implemented** | [`NOTIF-01`](../FINDINGS.md#notif-01)                                        |
| **Deliver a push notification**                                                 | **Not Implemented** | Mock provider                                                                |
| SMS or e-mail notifications                                                     | Not Implemented     |                                                                              |
| Staff alerts (payment needs review, no courier found, delivery failed)          | Partially Completed | Events are routed to `admin:ops`; the admin console does not connect to it   |
| Live courier position for the customer                                          | Not Implemented     | Deliberately excluded from routing                                           |

## 3. Assessment

**Strong:** this is the most complete piece of infrastructure in the project. The chain is durable
end to end, delivery is at-least-once with a de-duplication key, routing is deny-by-default and
testable in isolation, and the earlier defect where a subscription sent immediately after
connecting was silently dropped has been fixed at the right layer.

**The irony:** all of this durability serves the _display_ of state. The _changes_ of state between
modules still travel on the in-process bus ([`ARCH-01`](../FINDINGS.md#arch-01)). The same consumer
could drive those reactions.

**Weak:**

- Clients cannot keep a socket for more than 15 minutes because nothing refreshes tokens
  ([`FE-02`](../FINDINGS.md#fe-02)).
- Notifications reach nobody. For a courier with the app in the background, that is the difference
  between a usable product and not ([`COUR-01`](../FINDINGS.md#cour-01)).
- Operational signals are emitted into a room no one is in.
- Redis is the transport; if Redis loses data, events are lost. Acceptable for display — every
  client refetches over REST — and one more reason not to leave business reactions on it without
  reconcilers.
- The gateway accepts any origin (authentication is by token, not cookie, so the exposure is low).

## 4. Findings and tasks

`NOTIF-01` → T-502 · `RT-01` → T-606 · `FE-02` → T-207 · `ARCH-01` → T-301 · `COUR-01` → T-211.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
