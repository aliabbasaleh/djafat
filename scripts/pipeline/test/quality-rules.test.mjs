// check-hygiene and the ESLint overlays added by the pipeline (domain purity,
// React) — exercised with the REAL rule definitions on isolated snippets.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { checkHygiene } from '../check-hygiene.mjs';
import { makeTree, messages, REPO, runCli } from './helpers.mjs';

const fixtures = [];
const tree = (files) => {
  const t = makeTree(files);
  fixtures.push(t);
  return t;
};
after(() => fixtures.forEach((f) => f.cleanup()));

describe('check-hygiene', () => {
  const cases = [
    ['a focused test', { 'a.spec.ts': "it.only('x', () => {});\n" }, /focused-test/],
    ['a focused describe', { 'e2e/flow.ts': "describe.only('x', () => {});\n" }, /focused-test/],
    ['an unapproved skip', { 'a.spec.ts': "it.skip('x', () => {});\n" }, /unapproved-skip/],
    [
      'an unjustified eslint-disable',
      { 'src/a.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n' },
      /unjustified-disable/,
    ],
    ['a @ts-ignore', { 'src/a.ts': '// @ts-ignore\nconst x: number = "a";\n' }, /ts-ignore/],
  ];
  for (const [title, files, re] of cases) {
    it(`rejects ${title}`, () => {
      assert.match(messages(checkHygiene({ root: tree(files).root }).report), re);
    });
  }

  it('accepts approved skips, justified disables and patterns quoted in strings', () => {
    const t = tree({
      'a.spec.ts':
        "// skip-approved: needs Docker, see docs/36 §6.3\nit.skip('x', () => {});\nit('mentions it.only in a title', () => {});\n",
      'src/a.ts':
        "// eslint-disable-next-line no-console -- CLI output is the product here\nconsole.log(1);\nconst s = 'eslint-disable is a word';\n",
    });
    assert.deepEqual(checkHygiene({ root: t.root }).report.errors, []);
  });

  it('never lets a focused test into the baseline, and exits non-zero', () => {
    const t = tree({ 'a.spec.ts': "it.only('x', () => {});\n" });
    const baseline = join(t.root, 'b.json');
    writeFileSync(
      baseline,
      JSON.stringify({
        findings: [{ rule: 'focused-test', file: 'a.spec.ts', text: "it.only('x', () => {});" }],
      }),
    );
    assert.match(
      messages(checkHygiene({ root: t.root, baselinePath: baseline }).report),
      /focused-test/,
    );
    assert.equal(runCli('check-hygiene.mjs', ['--root', t.root, '--baseline', baseline]).code, 1);
  });

  it('tolerates a baselined disable but rejects a new one', () => {
    const t = tree({ 'src/a.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n' });
    const baseline = join(t.root, 'b.json');
    writeFileSync(
      baseline,
      JSON.stringify({
        findings: [
          {
            rule: 'unjustified-disable',
            file: 'src/a.ts',
            text: '// eslint-disable-next-line no-console',
          },
        ],
      }),
    );
    assert.deepEqual(checkHygiene({ root: t.root, baselinePath: baseline }).report.errors, []);
    t.write('src/b.ts', '/* eslint-disable */\n');
    assert.match(
      messages(checkHygiene({ root: t.root, baselinePath: baseline }).report),
      /src\/b.ts|unjustified-disable/,
    );
  });
});

// --- ESLint overlays --------------------------------------------------------
const req = createRequire(join(REPO, 'packages/eslint-config/package.json'));
const { ESLint } = req('eslint');
const tseslint = req('typescript-eslint');
const { domainPurity } = await import(
  pathToFileURL(join(REPO, 'packages/eslint-config/domain-purity.js')).href
);
const react = (await import(pathToFileURL(join(REPO, 'packages/eslint-config/react.js')).href))
  .default;

/** Lint a snippet with the given flat-config blocks only (syntax-level, no type info). */
async function lint(config, code, filePath) {
  const eslint = new ESLint({
    cwd: REPO,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      ...config,
    ],
  });
  const [result] = await eslint.lintText(code, { filePath: join(REPO, filePath) });
  return result.messages.map((m) => `${m.ruleId}: ${m.message}`).join('\n');
}

describe('domain purity overlay (packages/core, api pure helpers)', () => {
  const cfg = domainPurity(['packages/core/src/**/*.ts']);
  const file = 'packages/core/src/__fixture__.ts';
  for (const [title, code] of [
    ['reading the clock', 'export const f = () => Date.now();'],
    ['constructing the current date', 'export const f = () => new Date();'],
    ['drawing Math.random', 'export const f = () => Math.random();'],
    ['reading process.env', 'export const f = () => process.env.X;'],
    ['calling fetch', "export const f = () => fetch('https://x');"],
    ['touching localStorage', "export const f = () => localStorage.getItem('k');"],
  ]) {
    it(`rejects ${title}`, async () => {
      assert.match(await lint(cfg, code, file), /no-restricted-(syntax|globals)/);
    });
  }
  it('keeps the currency-identifier guard of the base config', async () => {
    assert.match(await lint(cfg, 'export const amountXaf = 1;', file), /Money/);
  });
  it('accepts injected clock and explicit dates', async () => {
    assert.equal(
      await lint(cfg, 'export const f = (nowMs: number) => new Date(nowMs).toISOString();', file),
      '',
    );
  });
  it('does not apply outside the domain files', async () => {
    assert.equal(
      await lint(
        cfg,
        'export const f = () => Date.now();',
        'apps/api/src/modules/orders/orders.service.ts',
      ),
      '',
    );
  });
});

describe('React overlay', () => {
  it('rejects a conditional hook', async () => {
    const code =
      "import { useState } from 'react';\nexport function C({ a }: { a: boolean }) { if (a) { useState(0); } return null; }\n";
    assert.match(
      await lint(react, code, 'apps/web/src/components/C.tsx'),
      /react-hooks\/rules-of-hooks/,
    );
  });
  it('rejects a missing effect dependency', async () => {
    const code =
      "import { useEffect } from 'react';\nexport function C({ id }: { id: string }) { useEffect(() => { void id; }, []); return null; }\n";
    assert.match(
      await lint(react, code, 'apps/web/src/components/C.tsx'),
      /react-hooks\/exhaustive-deps/,
    );
  });
  it('rejects browser storage used directly from a component', async () => {
    const code = "export function C() { return localStorage.getItem('t'); }\n";
    assert.match(await lint(react, code, 'apps/web/src/components/C.tsx'), /storage adapter/);
  });
  it('allows the storage adapter in lib/', async () => {
    const code = "export const read = () => localStorage.getItem('t');\n";
    assert.equal(await lint(react, code, 'apps/web/src/lib/auth-storage.ts'), '');
  });
});
