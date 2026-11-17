# Application: `apps/courier`

The courier's phone app: go online, receive delivery offers, pick up, deliver, confirm with the
customer's code, see earnings. It is the **only** interface a courier has.

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **State**    | **Broken** — cannot be bundled ([`MOB-01`](../FINDINGS.md#mob-01))                                                 |
| **Stack**    | Expo 53 · React Native 0.79.2 · expo-router · expo-location · expo-secure-store · `@djafat/sdk` · socket.io-client |
| **Size**     | 25 files, ≈1 500 lines                                                                                             |
| **Tests**    | 9 unit tests (formatting, idempotency-key helper)                                                                  |
| **Build**    | ❌ `expo export` fails: `Unable to resolve module regenerator-runtime/runtime`                                     |
| **Evidence** | Screens and logic read in source; **nothing was run on a device or simulator**                                     |

## 1. Structure

```text
app/
├── (auth)/login.tsx       OTP login
├── (app)/home.tsx         online/offline, incoming offers
├── (app)/delivery.tsx     active delivery: details, pickup, code entry, report a problem
├── (app)/earnings.tsx     balance: pending and available
└── index.tsx · _layout.tsx
components/   BigButton · Badge · Screen
lib/          api · auth-context · auth-storage (secure store) · location · realtime · idempotency · format
```

## 2. Features (from source)

| Feature                                  | State                   | Notes                                                                                        |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| Login by one-time code                   | Implemented, unverified | Tokens kept in the device's secure store (appropriate)                                       |
| Go online / offline                      | Implemented, unverified | API verified LIVE                                                                            |
| Send position                            | Partially Completed     | Foreground only (`watchPositionAsync`)                                                       |
| Receive an offer, accept or refuse       | Implemented, unverified | API verified LIVE; offers last 30 seconds                                                    |
| See pickup and drop-off details          | Implemented, unverified | Restaurant name, address, phone; drop-off landmark and phone                                 |
| Confirm pickup                           | Implemented, unverified | API verified LIVE                                                                            |
| Enter the customer's delivery code       | Implemented, unverified | API verified LIVE; five wrong attempts lock the delivery ([`DLV-02`](../FINDINGS.md#dlv-02)) |
| Report a failed delivery                 | Implemented, unverified | API verified by role test                                                                    |
| Earnings                                 | Partially Completed     | Two totals; no history, no payout ([`PAY-06`](../FINDINGS.md#pay-06))                        |
| Map and navigation                       | Not Implemented         | Addresses as text only                                                                       |
| Push notification of an offer            | Not Implemented         | Mock push provider server-side ([`NOTIF-01`](../FINDINGS.md#notif-01))                       |
| Background location                      | Not Implemented         | Called out in the source as the main remaining work                                          |
| Cash handling (amount to collect, float) | Not Implemented         | Tied to [`PAY-02`](../FINDINGS.md#pay-02)                                                    |
| Onboarding, documents, vehicle           | Not Implemented         | An administrator grants the role through the API                                             |
| Stay logged in                           | Not Implemented         | 15-minute session ([`FE-02`](../FINDINGS.md#fe-02))                                          |

According to the block report (`docs/36-bloc-13-hardening.md`) and the helper in `lib/idempotency.ts`,
each mutating action sends a fresh idempotency key and disables its button while in flight; this
was not re-checked.

## 3. Why it cannot work in the field yet

1. **It does not build.** Metro cannot resolve React Native's own dependencies under pnpm's
   isolated `node_modules` layout. The real distribution path (`eas build`) has never been tried.
2. **A courier with the screen locked becomes invisible.** Dispatch only considers couriers whose
   position is newer than 120 seconds, and the app reports position only while in the foreground
   ([`COUR-01`](../FINDINGS.md#cour-01)).
3. **Offers expire in 30 seconds and nothing announces them** unless the app is open on screen.
4. **The session ends every 15 minutes.**
5. **Cash, the expected payment method, is not supported** end to end.

## 4. Outstanding tasks

T-210 (bundle, device build) → T-211 (background location, push) → T-207 (token refresh) →
T-202 (cash) → T-216 (earnings history, payouts) → maps and navigation (not yet a task; add when
T-210 is done).

Last updated: 2026-11-11 (evidence collected 2026-11-10)
