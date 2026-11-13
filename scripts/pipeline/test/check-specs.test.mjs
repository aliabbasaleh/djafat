// Invalid specs are rejected; broken references, missing images, stale briefs
// and unmapped scenarios are detected; a complete valid feature passes.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpecs } from '../check-specs.mjs';
import { makeTree, messages, runCli } from './helpers.mjs';

const F = 'docs/features/FEAT-001-demo';

const featureMd = ({ ui = 'no', vis = 'N/A — feature backend uniquement' } = {}) => `---
id: FEAT-001
title: Demo
status: ready
type: change
ui: ${ui}
---

# FEAT-001 — Demo

## Objectif utilisateur

Un client veut X.

## Comportement attendu

Il voit Y.

## Périmètre et exclusions

- Dans : Y

## Critères d'acceptation

- **FEAT-001-AC01** — Y est visible
- **FEAT-001-AC02** — Z est refusé

## Dépendances et contraintes

Aucune.

## Questions ouvertes

Aucune.

## Références visuelles

${vis}
`;

const SECTIONS = [
  'Comportement observable',
  'Règles métier',
  'Erreurs et cas limites',
  'Contrats API et données',
  'Autorisations',
  'UI et accessibilité',
  'Références visuelles',
  'Migrations',
  'Hypothèses et questions ouvertes',
  'Stratégie de validation',
  "Modules existants et points d'intégration",
];

const specMd = ({ status = 'implemented', version = 1, scenarios, omit } = {}) => `---
id: SPEC-001-01
feature: FEAT-001
title: Demo spec
status: ${status}
version: ${version}
covers: [FEAT-001-AC01, FEAT-001-AC02]
---

# SPEC-001-01 — Demo spec

## Scénarios

${
  scenarios ??
  `### SPEC-001-01-SC01 — nominal

Critères : FEAT-001-AC01

- **Étant donné** a
- **Quand** b
- **Alors** c

### SPEC-001-01-SC02 — refus

Critères : FEAT-001-AC02

- **Étant donné** a
- **Quand** b
- **Alors** refusé`
}

${SECTIONS.filter((s) => s !== omit)
  .map((s) => `## ${s}\n\nN/A — démo`)
  .join('\n\n')}
`;

const clarMd = (
  row = '| FEAT-001-Q01 | délai ? | oui | tranchée | 10 min (PO, 2026-11-06) | SPEC-001-01 |',
) =>
  `| ID | Question | Bloquant | Statut | Décision | Specs |\n| -- | -- | -- | -- | -- | -- |\n${row}\n`;

const VALID = {
  [`${F}/feature.md`]: featureMd(),
  [`${F}/specs/SPEC-001-01.md`]: specMd(),
  [`${F}/clarifications.md`]: clarMd(),
  [`${F}/brief.md`]: '---\nfeature: FEAT-001\nspecs: [SPEC-001-01@1]\n---\n\n# brief\n',
  'apps/api/src/demo.spec.ts': "it('SPEC-001-01-SC01 nominal', () => {});\n// SPEC-001-01-SC02\n",
};

const fixtures = [];
function check(overrides = {}, remove = []) {
  const files = { ...VALID, ...overrides };
  for (const r of remove) delete files[r];
  const t = makeTree(files);
  fixtures.push(t);
  return { ...checkSpecs({ root: t.root }), root: t.root };
}
after(() => fixtures.forEach((f) => f.cleanup()));

describe('check-specs', () => {
  it('accepts a complete, traceable feature', () => {
    const { report } = check();
    assert.deepEqual(report.errors, []);
  });

  const invalid = [
    [
      'a spec missing a required section',
      { [`${F}/specs/SPEC-001-01.md`]: specMd({ omit: 'Autorisations' }) },
      /missing section "## Autorisations"/,
    ],
    [
      'a scenario without a Then step',
      {
        [`${F}/specs/SPEC-001-01.md`]: specMd({
          scenarios:
            '### SPEC-001-01-SC01 — x\n\nCritères : FEAT-001-AC01\n\n- **Étant donné** a\n- **Quand** b',
        }),
      },
      /missing \*\*Alors\/Then\*\*/,
    ],
    [
      'a scenario naming no acceptance criterion',
      {
        [`${F}/specs/SPEC-001-01.md`]: specMd({
          scenarios:
            '### SPEC-001-01-SC01 — x\n\n- **Étant donné** a\n- **Quand** b\n- **Alors** c',
        }),
      },
      /must name the acceptance criteria/,
    ],
    [
      'a duplicate ID',
      {
        [`${F}/specs/SPEC-001-01.md`]: specMd({
          scenarios:
            '### SPEC-001-01-SC01 — x\n\nCritères : FEAT-001-AC01\n\n- **Étant donné** a\n- **Quand** b\n- **Alors** c\n\n### SPEC-001-01-SC01 — y\n\nCritères : FEAT-001-AC02\n\n- **Étant donné** a\n- **Quand** b\n- **Alors** c',
        }),
      },
      /duplicate ID SPEC-001-01-SC01/,
    ],
    [
      'a broken reference from a test',
      { 'apps/api/src/other.spec.ts': "it('SPEC-001-01-SC09', () => {});\n" },
      /broken reference: SPEC-001-01-SC09/,
    ],
    [
      'an implemented scenario with no test',
      { 'apps/api/src/demo.spec.ts': "it('SPEC-001-01-SC01', () => {});\n" },
      /SPEC-001-01-SC02: status "implemented" but no test/,
    ],
    [
      'a stale brief (spec version bumped)',
      { [`${F}/specs/SPEC-001-01.md`]: specMd({ version: 2 }) },
      /brief is stale/,
    ],
    [
      'a clarified spec with a blocking open question',
      {
        [`${F}/clarifications.md`]: clarMd(
          '| FEAT-001-Q01 | délai ? | oui | ouverte |  | SPEC-001-01 |',
        ),
      },
      /blocking question FEAT-001-Q01 is still open/,
    ],
    [
      'a blocking product question settled by assumption',
      {
        [`${F}/clarifications.md`]: clarMd(
          '| FEAT-001-Q01 | délai ? | oui | hypothèse | 10 min | SPEC-001-01 |',
        ),
      },
      /cannot be settled by an assumption/,
    ],
    [
      'an uncovered acceptance criterion',
      {
        [`${F}/feature.md`]: featureMd().replace(
          '- **FEAT-001-AC02** — Z est refusé',
          '- **FEAT-001-AC02** — Z est refusé\n- **FEAT-001-AC03** — W',
        ),
      },
      /FEAT-001-AC03 is not covered by any spec/,
    ],
    [
      'a UI change without visual references',
      { [`${F}/feature.md`]: featureMd({ ui: 'yes' }) },
      /ui: yes but no visual reference/,
    ],
    [
      'a missing local image',
      {
        [`${F}/feature.md`]: featureMd({
          ui: 'yes',
          vis: '| ID | Source | Objet | Nature | Écran | Viewport | Annot. | Critères | Autorité |\n| - | - | - | - | - | - | - | - | - |\n| FEAT-001-VIS01 | assets/expected.png | cible | attendu | /panier | 390×844 | - | FEAT-001-AC01 | faisant-foi |',
        }),
      },
      /missing asset: assets\/expected.png/,
    ],
    [
      'a current-state screenshot presented as the approved target',
      {
        [`${F}/feature.md`]: featureMd({
          ui: 'yes',
          vis: '| ID | Source | Objet | Nature | Écran | Viewport | Annot. | Critères | Autorité |\n| - | - | - | - | - | - | - | - | - |\n| FEAT-001-VIS01 | assets/now.png | avant | actuel | /panier | 390×844 | - | FEAT-001-AC01 | faisant-foi |',
        }),
        [`${F}/assets/now.png`]: 'png',
      },
      /only an "attendu" reference can be "faisant-foi"/,
    ],
    [
      'a broken inline image in any feature document',
      { [`${F}/progress.md`]: '# p\n\n![run](assets/exec-1.png)\n' },
      /missing asset: assets\/exec-1.png/,
    ],
    [
      'a feature without front matter',
      { [`${F}/feature.md`]: '# FEAT-001\n' },
      /missing front matter/,
    ],
  ];
  for (const [title, overrides, re] of invalid) {
    it(`rejects ${title}`, () => {
      assert.match(messages(check(overrides).report), re);
    });
  }

  it('does not gate the specs on a blocking question deferred out of scope', () => {
    const { report } = check({
      [`${F}/clarifications.md`]: clarMd(
        '| FEAT-001-Q01 | délai ? | oui | tranchée | 10 min | SPEC-001-01 |\n| FEAT-001-Q02 | timeout ? | oui | ouverte |  | hors périmètre — FU-1 |',
      ),
    });
    assert.deepEqual(report.errors, []);
  });

  it('accepts an existing local image and warns on a remote one', () => {
    const vis =
      '| ID | Source | Objet | Nature | Écran | Viewport | Annot. | Critères | Autorité |\n| - | - | - | - | - | - | - | - | - |\n| FEAT-001-VIS01 | assets/now.png | avant | actuel | /panier | 390×844 | - | FEAT-001-AC01 | contextuel |\n| FEAT-001-VIS02 | assets/expected.png | cible | attendu | /panier | 390×844 | - | FEAT-001-AC01 | faisant-foi |\n| FEAT-001-VIS03 | https://example.com/x.png | idée | inspiration | /panier | ? | - | FEAT-001-AC01 | contextuel |';
    const { report } = check({
      [`${F}/feature.md`]: featureMd({ ui: 'yes', vis }),
      [`${F}/assets/now.png`]: 'png',
      [`${F}/assets/expected.png`]: 'png',
    });
    assert.deepEqual(report.errors, []);
    assert.match(report.warnings.map((w) => w.message).join('\n'), /remote visual reference/);
  });

  it('only warns about unmapped scenarios while a spec is still clarified', () => {
    const { report } = check({
      [`${F}/specs/SPEC-001-01.md`]: specMd({ status: 'clarified' }),
      'apps/api/src/demo.spec.ts': '',
    });
    assert.deepEqual(report.errors, []);
    assert.match(report.warnings.map((w) => w.message).join('\n'), /no test mapped yet/);
  });

  it('exits non-zero from the CLI on an invalid spec, zero on a valid one', () => {
    const bad = check({ [`${F}/specs/SPEC-001-01.md`]: specMd({ omit: 'Migrations' }) });
    assert.equal(runCli('check-specs.mjs', ['--root', bad.root]).code, 1);
    const good = check();
    const r = runCli('check-specs.mjs', ['--root', good.root, '--matrix', 'FEAT-001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SPEC-001-01-SC02/);
  });
});
