/**
 * `packages/ui` is typechecked by plain `tsc`, not by Next.js (which
 * provides `*.module.css` typings for free via `next-env.d.ts` in every
 * Next.js app) — this is the one ambient declaration this package needs
 * that a Next.js app gets automatically.
 */
declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}
