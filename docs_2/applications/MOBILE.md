# Application: `apps/mobile`

The customer's phone app, built on the same API and SDK as the website.

|              |                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **State**    | **Broken** — cannot be bundled ([`MOB-01`](../FINDINGS.md#mob-01)); journey incomplete ([`FE-01`](../FINDINGS.md#fe-01)) |
| **Stack**    | Expo 53 · React Native 0.79.2 · expo-router · expo-secure-store · `@djafat/sdk` · socket.io-client                       |
| **Size**     | 27 files, ≈2 160 lines                                                                                                   |
| **Tests**    | 5 unit tests (helpers)                                                                                                   |
| **Build**    | ❌ `expo export` fails, same cause as the courier app; it is the failing step of the root build and of CI                |
| **Evidence** | Read in source; **nothing was run on a device or simulator**                                                             |

## 1. Structure

```text
app/
├── (auth)/login.tsx
├── (app)/restaurants/index.tsx                       list
├── (app)/restaurants/[slug]/index.tsx                restaurant and menu
├── (app)/restaurants/[slug]/products/[productId].tsx product and options
├── (app)/cart.tsx                                    cart and checkout
├── (app)/addresses.tsx                               address book
├── (app)/orders/[id].tsx                             order page
└── index.tsx · _layout.tsx
components/   Button · Screen · Stepper
lib/          api · auth-context · auth-storage (secure store) · realtime · idempotency · format
```

## 2. Features (from source)

SDK calls found in the app: catalog (list, restaurant, menu, product), cart (get, add, update,
remove, quote), addresses (list, create, remove, set default), orders (create, get), and the two
login calls. Nothing else.

| Feature                                           | State                                             |
| ------------------------------------------------- | ------------------------------------------------- |
| Login by one-time code                            | Implemented, unverified                           |
| Restaurant list, restaurant, product with options | Implemented, unverified                           |
| Cart, quote, address choice, place order          | Implemented, unverified                           |
| Order page with live status                       | Implemented, unverified                           |
| **Payment**                                       | **Not Implemented**                               |
| Delivery code                                     | Not Implemented ([`FE-03`](../FINDINGS.md#fe-03)) |
| Order history                                     | Not Implemented (the API route exists)            |
| Search, filters, categories                       | Not Implemented (available on the website)        |
| Edit an address                                   | Not Implemented (no update call)                  |
| Tab navigation, tablet layout                     | Not Implemented (noted as debt in `docs/35`)      |
| Map, courier tracking                             | Not Implemented                                   |
| Push notifications                                | Not Implemented                                   |
| Offline queue, data-saver mode                    | Not Implemented (called for by the design brief)  |
| Stay logged in                                    | Not Implemented ([`FE-02`](../FINDINGS.md#fe-02)) |

**FEAT-020** _(updated 2026-11-21, sync S-035)_: on the branch `feat/compte-email-password`, the signed-out screen becomes « Mon compte » (sign-in by password or code, registration, forgotten password). Its logic is unit-tested (shared with the site through `@djafat/sdk`); the screen itself could not be seen — no Expo build exists yet ([`MOB-01`](../FINDINGS.md#mob-01)).

## 3. Assessment

This app is a thinner copy of the website and shares its dead end at payment. Since the website is
designed phone-first and can be reached without an app store, the sensible order is: finish the
journey on the website, then bring this app to parity once it builds. The courier app has no web
alternative and should get the bundling fix first.

## 4. Outstanding tasks

T-210 (bundle, device build) → T-201 (payment) → T-208 (delivery code) → T-207 (token refresh) →
T-217 (history, profile) → T-502 (push).

Last updated: 2026-11-21 (sync S-035)
