# UI and UX audit

What the applications look like and do when a person uses them. Based on driving the three web
apps in headless Chrome on 2026-11-10 — production builds (`next build` + `next start`) against the
running API — at 390 × 844 (phone) for the customer site and 1280 × 800 for the consoles. The two
Expo apps could not be built, so their screens were read in code only.

Two passes were made, and the difference between them matters:

- **As shipped.** Nothing was altered.
- **Patched in the page.** `window.fetch` was wrapped before the page's scripts ran, which removes
  the single defect [`SDK-01`](FINDINGS.md#sdk-01) without touching the build. This pass shows what
  is behind the login. Nothing observed in it is usable today.

## 1. As shipped

| App                | Result                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer site      | Home, restaurant list, restaurant page and product page render (server-side). **Login fails**: the form shows "Impossible d'envoyer le code. Vérifiez le numéro…" and no request leaves the browser. Cart, addresses and order pages redirect to login |
| Restaurant console | Login fails the same way. Nothing else is reachable                                                                                                                                                                                                    |
| Admin console      | Login fails the same way. Nothing else is reachable                                                                                                                                                                                                    |

The message blames the phone number, which is wrong and would send a user and a support agent in
the wrong direction. The login pages catch every error and show one text
([`FE-06`](FINDINGS.md#fe-06)).

## 2. Customer site (patched pass)

Visual language: warm off-white background, orange accent, large touch targets, a bottom tab bar
(Accueil, Restaurants, Panier, Adresses). It reads as a phone application, as intended. French
throughout.

| Screen                                    | Works | Observations                                                                                                                               |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Home                                      | ✅    | Hero, search box, category chips, restaurant cards                                                                                         |
| Restaurant list                           | ✅    | Search, "open now" filter, four sort orders, open/closed badges, pagination. Images are broken placeholders ([`FE-05`](FINDINGS.md#fe-05)) |
| Restaurant                                | ✅    | Rating, preparation time, minimum order, address, menu by category                                                                         |
| Product                                   | ✅    | Required option group as radio buttons with price differences, quantity stepper, add to cart                                               |
| Login                                     | ✅    | Two steps: phone, then six-digit code. Promises an SMS that is never sent ([`AUTH-01`](FINDINGS.md#auth-01))                               |
| Cart                                      | ✅    | Lines with options, quantity controls, remove, clear; subtotal, delivery fee, total; address selection; **Commander**                      |
| Address book                              | ✅    | List, add, edit, delete, default. Landmark field present. No map — coordinates cannot be set by a person                                   |
| Order page                                | ⚠️    | Shows the order and "Suivi en direct activé". With status "En attente de paiement" the only action is "Continuer mes achats"               |
| Order history                             | ❌    | `/commandes` is the generic 404, worded for a missing restaurant or dish ([`FE-04`](FINDINGS.md#fe-04))                                    |
| Profile, logout-everywhere, notifications | ❌    | Do not exist                                                                                                                               |

### The journey stops at payment

```text
browse → product → cart → Commander → "En attente de paiement"  ✗ no next step
                                        (order expires 15 minutes later)
```

There is no payment screen, no choice of method, and no SDK call to create a payment
([`FE-01`](FINDINGS.md#fe-01)). The minimum order shown on the restaurant page is not applied in
the cart ([`ORD-03`](FINDINGS.md#ord-03)). Once an order is under way, the delivery code the
courier will ask for is not shown anywhere ([`FE-03`](FINDINGS.md#fe-03)). A customer cannot cancel
([`ORD-01`](FINDINGS.md#ord-01)).

### Details

- At 390 px the header puts "Panier" and "Déconnexion — Client Test" side by side; the second
  wraps onto two lines. The header "Panier" button duplicates the tab bar.
- After 15 minutes any action sends the user back to login ([`FE-02`](FINDINGS.md#fe-02)).
- No favicon (404 on every page load); the app has no `public/` directory at all.
- No offline or poor-network handling was observed, although the design brief stresses it; no
  service worker or web manifest exists in the source (the design calls for an installable web
  app; the `pwa_install_prompt` flag is off).

## 3. Restaurant console (patched pass)

| Screen             | Works       | Observations                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order board        | ✅          | Four columns (Nouvelles, En préparation, Prêtes, En livraison), cards with items and total, Accepter / Refuser, sound toggle, "Temps réel actif" indicator. Live delivery of events to the restaurant's room was verified at the socket; a card appearing on the board without a reload was not observed directly |
| History            | ✅          | Filter by final status, paginated table                                                                                                                                                                                                                                                                           |
| Menu               | ✅          | Categories and products, create and edit in modals, availability toggle. Image is a URL field                                                                                                                                                                                                                     |
| Hours              | ✅          | Seven days, open/closed and times, city time zone shown                                                                                                                                                                                                                                                           |
| Balance ("Relevé") | ✅          | Pending and available amounts. Labels include the English words "pending" and "available". No statement lines, no payout request                                                                                                                                                                                  |
| Profile            | ✅          | Name, phone, address, preparation time, minimum order, description, logo and cover URLs, "Fermer maintenant"                                                                                                                                                                                                      |
| Support            | Placeholder | Text telling the restaurant to contact its DJAFAT representative                                                                                                                                                                                                                                                  |

Observations: an order that had waited 4 h 42 looked the same as a new one — no ageing colour, no
timer, no escalation ([`ORD-02`](FINDINGS.md#ord-02)). The board is the screen that stays open all
day and it is the one most hurt by the 15-minute session. There is no way to mark a single item
unavailable from an order, no printing, no preparation-time adjustment per order. The restaurant's
position on a map cannot be set ([`DLV-01`](FINDINGS.md#dlv-01)).

## 4. Admin console (patched pass)

| Screen      | Works | Observations                                                                                                          |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| Dashboard   | ✅    | Five link cards; no figures                                                                                           |
| Users       | ✅    | Search by phone or name; detail page with roles and action history; grant/revoke role; suspend, block, reactivate     |
| Orders      | ✅    | Filter by status and restaurant ID; statuses shown as raw identifiers (`awaiting_payment`); no detail page, no action |
| Restaurants | ✅    | List with status and a "show balance" link; no create, activate or edit                                               |
| Couriers    | ✅    | Rows show a UUID and a status only — no name or phone; suspend/reinstate                                              |
| Finance     | ✅    | Totals owed to restaurants and couriers; platform accounts; read-only                                                 |

A customer account that logs in is refused with a clear message. But: **role grant and revoke
cannot succeed from this console** — the API demands an MFA step-up and the console has no MFA
screen ([`ADM-03`](FINDINGS.md#adm-03)). There is no screen for refunds, settlements, order
intervention, restaurant onboarding, courier onboarding, platform settings or commission rules.
As built, the console lets staff look, and suspend.

## 5. Courier and customer phone apps (code reading only)

Neither bundles ([`MOB-01`](FINDINGS.md#mob-01)).

- **Courier** (`apps/courier/app`): login; home with an online/offline switch and incoming offers;
  active delivery with restaurant and drop-off details, pickup, code entry, report failure;
  earnings (balance). Location is sent while the app is in the foreground only; no map, no
  navigation hand-off, no push ([`COUR-01`](FINDINGS.md#cour-01)).
- **Customer** (`apps/mobile/app`): login; restaurant list; restaurant; product; cart; addresses;
  order page. Same missing pieces as the website — no payment, no history, no delivery code — plus
  no search and no tab navigation.

## 6. Consistency and design system

The three web apps share `@djafat/ui` (64 components and primitives, 56 tests) and
`@djafat/tokens`; they look like one product. The customer site has loading skeletons for its
catalog routes and its own error and not-found pages; the two consoles have none of the three and
fall back to the framework defaults. Empty states are present on the board and the cart. The phone
apps use the same tokens with their own small component set.

## 7. Accessibility and performance

Not measured ([`QA-01`](FINDINGS.md#qa-01)). From what was seen: form fields have visible labels;
buttons are real buttons; colour is not the only status signal on badges (text is present). No
keyboard, screen-reader, contrast or slow-network test was run, and no Lighthouse report exists.
Build output reports 105 kB of shared first-load JavaScript and 120–143 kB per route.

## 8. Language

All user-facing text is French, written inline in pages; `@djafat/i18n` is used in five files.
Status names in the admin console and two labels in the restaurant balance are English identifiers.
Arabic is planned for a later version and nothing prepares for right-to-left yet
([`I18N-01`](FINDINGS.md#i18n-01)).

## 9. Priorities for the interface

1. Make the apps reach the API ([`SDK-01`](FINDINGS.md#sdk-01)) — everything else is invisible until then.
2. Complete the customer journey: payment, delivery code, cancellation, history
   ([`FE-01`](FINDINGS.md#fe-01), [`FE-03`](FINDINGS.md#fe-03), [`ORD-01`](FINDINGS.md#ord-01), [`FE-04`](FINDINGS.md#fe-04)).
3. Keep people logged in ([`FE-02`](FINDINGS.md#fe-02)).
4. Give staff the screens to act: MFA, refunds, order intervention, onboarding ([`ADM-03`](FINDINGS.md#adm-03)).
5. Tell the truth in error messages; age and escalate waiting orders on the board.
6. Then polish, measure accessibility and performance on a low-end Android phone and a slow network.

Last updated: 2026-11-11 (evidence collected 2026-11-10)
