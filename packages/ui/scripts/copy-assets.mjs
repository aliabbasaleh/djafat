// `tsc` only compiles `.ts`/`.tsx` — it never copies the co-located
// `*.module.css` files into `dist/`. Every compiled component still
// `import`s its stylesheet by a relative path (e.g. `./Button.module.css`),
// so the sibling file must physically exist next to the compiled `.js` for
// a consumer's bundler (Next.js) to resolve it. This is the one extra build
// step `@djafat/ui` needs that every other (CSS-free) workspace package
// doesn't (docs/21 §2).
import { cpSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}/src`;
const dist = `${root}/dist`;

if (!existsSync(dist)) {
  throw new Error('dist/ does not exist — run `tsc -p tsconfig.build.json` first.');
}

cpSync(src, dist, {
  recursive: true,
  filter: (source) => statSync(source).isDirectory() || extname(source) === '.css',
});

console.log('[@djafat/ui] copied *.module.css into dist/');
