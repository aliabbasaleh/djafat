# Application: `apps/web`

The customer website: browse restaurants, build a cart, order, follow the order. Designed
phone-first. French.

|                 |                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **State**       | **Broken** in a browser ([`SDK-01`](../FINDINGS.md#sdk-01)); journey incomplete ([`FE-01`](../FINDINGS.md#fe-01)) |
| **Stack**       | Next.js 15.1.3 (App Router) · React 19 · `@djafat/ui` · `@djafat/sdk` · socket.io-client                          |
| **Size**        | 29 source files, ≈2 480 lines                                                                                     |
| **Tests**       | None                                                                                                              |
| **Build / run** | ✅ `next build`; served with `next start` and driven in headless Chrome on 2026-11-10                             |
| **Port**        | 3000                                                                                                              |

## 1. Structure

```text
src/app/
├── page.tsx                                   home (server-rendered)
├── restaurants/page.tsx                       list, search, filters, sort (server-rendered)
├── restaurants/[slug]/page.tsx                restaurant and menu (server-rendered)
├── restaurants/[slug]/products/[productId]/   product and options
├── connexion/                                 OTP login
├── panier/                                    cart and checkout
├── adresses/                                  address book
├── commandes/[id]/                            order page with live updates
└── layout · error · not-found · loading
src/components/   CartIndicator · CategoryChipRow · Pagination · ProductOptionsForm · SearchForm
src/lib/          api (SDK instance) · auth-storage · realtime · availability · format
```

Catalog pages are rendered on the server and work without JavaScript-side API calls. Everything
behind login runs in the browser.

## 2. Features

"Patched" = observed only with the SDK defect worked around inside the browser; not usable as shipped.

| Feature                                                          | State                       | Evidence                                                       |
| ---------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| Home, categories, search box                                     | Completed                   | LIVE, as shipped                                               |
| Restaurant list: search, open-now filter, four sorts, pagination | Completed                   | LIVE, as shipped                                               |
| Restaurant page and menu                                         | Completed                   | LIVE, as shipped                                               |
| Product page with required options                               | Completed                   | LIVE, as shipped (render); add-to-cart LIVE patched            |
| Login by one-time code                                           | Broken                      | LIVE — no request leaves the browser                           |
| Cart: lines, quantities, totals, address choice                  | Completed behind the defect | LIVE patched                                                   |
| Place an order                                                   | Completed behind the defect | LIVE patched                                                   |
| **Pay for the order**                                            | **Not Implemented**         | LIVE patched — dead end at "En attente de paiement"            |
| Order page with live status                                      | Partially Completed         | LIVE patched; realtime verified at the socket                  |
| See the delivery code                                            | Not Implemented             | CODE ([`FE-03`](../FINDINGS.md#fe-03))                         |
| Cancel an order                                                  | Not Implemented             | No API route ([`ORD-01`](../FINDINGS.md#ord-01))               |
| Address book: add, edit, delete, default                         | Completed behind the defect | LIVE patched. No map: coordinates cannot be entered            |
| Order history                                                    | Not Implemented             | LIVE — `/commandes` is a 404 ([`FE-04`](../FINDINGS.md#fe-04)) |
| Profile, notifications                                           | Not Implemented             | CODE                                                           |
| Stay logged in beyond 15 minutes                                 | Not Implemented             | CODE ([`FE-02`](../FINDINGS.md#fe-02))                         |
| Installable / offline-tolerant web app                           | Not Implemented             | No manifest or service worker in the source                    |
| Minimum-order message in the cart                                | Not Implemented             | [`ORD-03`](../FINDINGS.md#ord-03)                              |

## 3. Observations

- Session data — access token, 30-day refresh token, user — is kept in `localStorage`
  ([`SEC-05`](../FINDINGS.md#sec-05)). The refresh token is stored and never used.
- Every error on the login page shows the same sentence, blaming the phone number
  ([`FE-06`](../FINDINGS.md#fe-06)).
- Seeded images fail through the image optimiser ([`FE-05`](../FINDINGS.md#fe-05)).
- No `public/` directory: no favicon, no icons.
- The image configuration allows one remote host (`placehold.co`), used only by seed data; real
  images have no upload path ([`STOR-01`](../FINDINGS.md#stor-01)).
- `next@15.1.3` carries published critical vulnerabilities ([`DEP-01`](../FINDINGS.md#dep-01)): five,
  four of them remote code execution — one in the App Router's React flight protocol, two in the
  Image Optimization API that `next/image` uses here, one on Windows-hosted servers. None affects
  15.5.28 or later, according to the advisories _(updated 2026-11-11, sync S-003)_.
- Interface review: [`../UI_UX_AUDIT.md`](../UI_UX_AUDIT.md) §2.

## 4. Outstanding tasks

T-101 (SDK) → T-201 (payment step) → T-208 (delivery code) → T-207 (token refresh) → T-204
(cancellation) → T-217 (history, profile) → T-209 (minimum order) → T-307 (token storage, CSP) →
T-501 (polish) → T-602 (browser tests) → T-506 (accessibility, performance).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
