'use client';

/**
 * A thin local re-export boundary for every `'use client'` component of
 * `@djafat/ui` that `apps/web` actually renders. Next.js's `transpilePackages`
 * does not reliably preserve a `'use client'` directive that lives INSIDE an
 * external transpiled workspace package once a page is statically prerendered
 * (`/_not-found` in this app) — a long-standing upstream limitation
 * (vercel/next.js#42699). Declaring the boundary here, in a file that is
 * part of `apps/web` itself, sidesteps it entirely while still reusing the
 * real implementation (docs/21 §17.2).
 */
export { Button, MobileNav, SearchInput, Checkbox, Select } from '@djafat/ui';
