# Application: `apps/restaurant`

The restaurant's console: receive and handle orders, manage the menu, opening hours and profile,
see the balance. Meant to stay open on a tablet or computer in the kitchen. French.

|                    |                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **State**          | **Broken** in a browser ([`SDK-01`](../FINDINGS.md#sdk-01)); functional behind that defect |
| **Stack**          | Next.js 15.1.3 · React 19 · `@djafat/ui` · `@djafat/sdk` · socket.io-client                |
| **Size**           | 28 source files, ≈2 380 lines                                                              |
| **Tests**          | 16 unit tests (formatting and status helpers)                                              |
| **Build / run**    | ✅ `next build`; served and driven in headless Chrome on 2026-11-10                        |
| **Port**           | 3003                                                                                       |
| **Who can use it** | `restaurant_owner` and `restaurant_staff`, each scoped to exactly one restaurant           |

## 1. Structure

```text
src/app/
├── login/                 OTP login (intended for restaurant accounts; the refusal of other accounts was not exercised)
└── restaurant/
    ├── page.tsx           order board (four columns, live)
    ├── history/           finished orders, filter and pagination
    ├── menu/              categories and products
    ├── hours/             weekly opening hours
    ├── wallet/            balance: pending and available
    ├── profile/           restaurant details, open/close now
    └── support/           placeholder text
src/components/   OrderBoard · OrderCard · ProductFormModal · CategoryFormModal · DataTable
src/lib/          api · auth-storage · realtime · sound · order-status · format
```

## 2. Features

All observations below are from the pass with the SDK defect worked around in the browser.

| Feature                                                          | State               | Notes                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                                                            | Broken as shipped   | Works when patched                                                                                                                          |
| Order board: new, in preparation, ready, out for delivery        | Completed           | Cards show code, age, items, options, total                                                                                                 |
| Accept / refuse an order                                         | Completed           | API verified LIVE; a refused **paid** order is not refunded ([`PAY-04`](../FINDINGS.md#pay-04))                                             |
| Mark ready                                                       | Completed           | One action moves the order through "preparing" to "ready" and triggers dispatch                                                             |
| Live updates and sound for new orders                            | Partially Completed | Event delivery to the restaurant's room verified at the socket; the board shows an "activate sound" control and a live-connection indicator |
| Order history                                                    | Completed           | Delivered, cancelled, refused, expired                                                                                                      |
| Menu: categories, products, options display, availability switch | Completed           | Create and edit in modals. Option groups are shown; editing them from this console was not exercised — Needs Verification                   |
| Opening hours                                                    | Completed           | The form shows one window per day; the schema allows several. Saving was not exercised in the browser                                       |
| Open / close now                                                 | Implemented         | Button present on the profile page; not exercised                                                                                           |
| Balance                                                          | Partially Completed | Two totals only: no statement lines, no payout request ([`PAY-06`](../FINDINGS.md#pay-06))                                                  |
| Profile                                                          | Completed           | Logo and cover are URL text fields — no upload ([`STOR-01`](../FINDINGS.md#stor-01))                                                        |
| Set the restaurant's position                                    | Not Implemented     | No field and no map ([`DLV-01`](../FINDINGS.md#dlv-01))                                                                                     |
| Support                                                          | Placeholder         | Static text                                                                                                                                 |
| Staff management by the owner                                    | Not Implemented     | Only an administrator can grant the staff role                                                                                              |
| Stay logged in                                                   | Not Implemented     | Session ends after 15 minutes ([`FE-02`](../FINDINGS.md#fe-02)) — the most damaging gap for a screen meant to stay open                     |

## 3. Observations

- **No ageing or escalation of waiting orders.** An order that had waited 4 h 42 looked like a new
  one. Nothing times it out ([`ORD-02`](../FINDINGS.md#ord-02)).
- `restaurant_staff` cannot change hours or profile (403 from the API, by design); the console
  shows the same screens to both roles — check that it explains the refusal.
- An owner can create a second restaurant through the API ([`ORD-04`](../FINDINGS.md#ord-04)); this
  console has no screen for it.
- The balance page labels include the English words "pending" and "available".
- No error, loading or not-found pages of its own; framework defaults apply.
- Tokens in `localStorage` ([`SEC-05`](../FINDINGS.md#sec-05)).
- `next@15.1.3` with the App Router: five published critical vulnerabilities, among them remote
  code execution in the React flight protocol; none affects 15.5.28 or later
  ([`DEP-01`](../FINDINGS.md#dep-01)) _(added 2026-11-11, sync S-003)_.
- Interface review: [`../UI_UX_AUDIT.md`](../UI_UX_AUDIT.md) §3.

## 4. Outstanding tasks

T-101 (SDK) → T-207 (token refresh) → T-212 (coordinates) → T-206 (confirmation time-out, with
board ageing) → T-503 (image upload) → T-216 (payouts and statement) → T-602 (browser tests).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
