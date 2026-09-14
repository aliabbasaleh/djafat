import type { CSSProperties } from 'react';

/** `style` objects that also set CSS custom properties (`--x`) — React's own `CSSProperties` type doesn't include them. */
export type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>;
