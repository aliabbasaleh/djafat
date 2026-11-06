---
name: feature-visual
description: Validate the UI of a DJAFAT feature (ui yes) against its expected-state visual references — render the real screens with the browser available, capture execution screenshots, compare with the spec's visual criteria and accessibility requirements. Use for UI features after implementation, or when the user asks for screenshots or a visual check.
---

# Visual validation

Three kinds of images, never mixed up:

| Kind                   | Where                                                              | Meaning                                                  |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Feature reference      | `docs/features/<dir>/assets/` (VIS ids in feature.md)              | input written by a human: actuel / attendu / inspiration |
| Reviewed test baseline | next to a visual test, only if a spec justifies visual regression  | approved by a human after review                         |
| Execution screenshot   | `docs/features/<dir>/assets/exec-<spec>-<scenario>-<viewport>.png` | evidence produced by this run                            |

## Steps

1. Start the app the spec targets (`pnpm --filter @djafat/web dev`, admin
   :3002, restaurant :3003; API + seed if the screen needs data — see
   docs/36 §0). The repository has **no Playwright suite**; in this cloud
   environment Chromium + Playwright are preinstalled (`require('playwright')`),
   so you may drive the page with a throwaway script in the scratchpad. Do not
   add a visual-regression dependency unless a spec explicitly justifies it.
2. Stabilise: fixed viewport (the one the reference states), seeded data,
   fonts loaded, animations settled, locale fr.
3. Capture one execution screenshot per scenario × viewport, saved with the
   naming above, referenced from `progress.md`.
4. Compare with each "attendu"/"faisant-foi" reference ONLY on the explicit
   criteria of the spec (text, presence, order, state). Open both images with
   the Read tool. If you cannot inspect an image, write "non vérifié
   visuellement — handoff humain" with the exact points to check.
5. Accessibility: roles/labels, focus order, contrast tokens — assert in
   component tests where possible (`packages/ui` uses @testing-library).
6. Never update a baseline to make a difference disappear; a difference is a
   finding for `/feature-review`.

## Success

Each visual criterion has execution evidence or an explicit human handoff;
mobile apps (`expo export` currently broken, see known failures) are marked
unavailable rather than claimed.
