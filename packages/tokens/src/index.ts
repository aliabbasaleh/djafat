import raw from './tokens.json';

/** Design tokens as a plain JS object (consumed by web CSS-var build + RN theme). */
export const tokens = raw as Omit<typeof raw, '$comment'>;
export type Tokens = typeof tokens;

/** Flatten nested tokens into `--djafat-a-b-c` CSS custom properties. */
export function toCssVariables(prefix = 'djafat'): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string[]): void => {
    if (node === null || typeof node !== 'object') {
      out[`--${prefix}-${path.join('-')}`] = String(node);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      walk(v, [...path, kebab(k)]);
    }
  };
  walk(tokens, []);
  return out;
}

/** Serialise the CSS variables into a `:root { ... }` block. */
export function toCssRootBlock(prefix = 'djafat'): string {
  const vars = toCssVariables(prefix);
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${body}\n}\n`;
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
