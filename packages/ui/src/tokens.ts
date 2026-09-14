/**
 * Bridges `@djafat/tokens`' UNITLESS numeric tokens (space/radius/type-size —
 * shared as-is with React Native, where sizes are plain numbers) into valid
 * CSS length values. `--djafat-space-md` resolves to the string `"16"`; used
 * directly as `gap: var(--djafat-space-md)` that is invalid at computed-value
 * time and the browser drops the declaration (the exact bug fixed in
 * `apps/web/src/app/error.tsx` at Bloc 2, docs/20 §19.1). Every component in
 * this package goes through `spaceVar`/`px` instead of writing `calc(...)`
 * inline everywhere.
 */
export const SPACE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;
export type SpaceKey = (typeof SPACE_KEYS)[number];

export function spaceVar(key: SpaceKey): string {
  return `calc(var(--djafat-space-${key}) * 1px)`;
}

/** Turns any unitless `--djafat-*` custom property into a `px` length. */
export function px(varName: string): string {
  return `calc(var(${varName}) * 1px)`;
}
