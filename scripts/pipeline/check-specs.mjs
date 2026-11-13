#!/usr/bin/env node
// Validates feature/spec artifacts under docs/features/ and their links to
// tests (docs/pipeline/README.md §Traçabilité). Exit 0 = valid, 1 = errors.
//
//   node scripts/pipeline/check-specs.mjs                 # whole repository
//   node scripts/pipeline/check-specs.mjs --matrix FEAT-001  # print traceability
//   node scripts/pipeline/check-specs.mjs --root <dir>    # fixtures
//
// A mapping is not proof of semantic adequacy: this checks that every link
// RESOLVES, never that a test actually asserts what its scenario says.
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  listSourceFiles,
  normHeading,
  parseArgs,
  parseFrontMatter,
  read,
  Report,
  sections,
  toPosix,
  walk,
  isMainModule,
} from './lib/common.mjs';

export const FEATURE_SECTIONS = [
  'Objectif utilisateur',
  'Comportement attendu',
  'Périmètre et exclusions',
  "Critères d'acceptation",
  'Dépendances et contraintes',
  'Questions ouvertes',
  'Références visuelles',
];

export const SPEC_SECTIONS = [
  'Comportement observable',
  'Règles métier',
  'Scénarios',
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

const FEATURE_STATUSES = ['draft', 'ready', 'in-progress', 'done'];
const FEATURE_TYPES = ['new', 'change', 'bugfix', 'retrospective'];
const SPEC_STATUSES = ['draft', 'clarified', 'implemented'];
const VIS_NATURES = ['actuel', 'attendu', 'inspiration'];
const VIS_AUTHORITIES = ['faisant-foi', 'contextuel'];

const ID_TOKEN = /\b(FEAT-\d{3}(?:-(?:AC|VIS|Q)\d{2})?|SPEC-\d{3}-\d{2}(?:-SC\d{2})?)\b/g;
const TEST_FILE = /\.(spec|test)\.(ts|tsx|js|mjs|cjs)$|(^|\/)e2e\/.+\.(ts|tsx|js|mjs)$/;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function tableRows(content) {
  return content
    .split('\n')
    .filter((l) => /^\|/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    )
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

/**
 * @param {{ root: string, featuresDir?: string }} opts
 * @returns {{ report: Report, model: object }}
 */
export function checkSpecs({ root, featuresDir = 'docs/features' }) {
  const report = new Report('check-specs');
  const base = resolve(root, featuresDir);
  const rel = (p) => toPosix(relative(root, p));

  /** id -> { kind, file, line, ...extra } */
  const defs = new Map();
  /** { id, file, line } */
  const refs = [];
  const features = [];
  const define = (id, kind, file, line, extra = {}) => {
    if (defs.has(id)) {
      const prev = defs.get(id);
      report.error(file, `duplicate ID ${id} (already defined in ${prev.file}:${prev.line})`, line);
      return;
    }
    defs.set(id, { id, kind, file, line, ...extra });
  };
  const collectRefs = (text, file, offset = 0) => {
    for (const m of text.matchAll(ID_TOKEN)) {
      refs.push({ id: m[1], file, line: lineOf(text, m.index) + offset });
    }
  };

  const featureDirs = existsSync(base)
    ? walk(base, (f) => f.endsWith('/feature.md') || f.endsWith('\\feature.md')).map(dirname)
    : [];

  for (const dir of featureDirs) {
    const dirName = toPosix(relative(base, dir));
    if (dirName.startsWith('_')) continue; // _templates
    const featureFile = join(dir, 'feature.md');
    const fRel = rel(featureFile);
    const text = read(featureFile);
    const { data, body, bodyOffsetLines } = parseFrontMatter(text);
    if (!data) {
      report.error(fRel, 'missing front matter (--- id/title/status/type/ui ---)');
      continue;
    }
    if (data.__invalid)
      report.error(fRel, `unparseable front matter line(s): ${data.__invalid.join(' | ')}`);
    const id = data.id;
    if (!/^FEAT-\d{3}$/.test(id ?? '')) {
      report.error(fRel, `front matter "id" must look like FEAT-001 (got "${id ?? ''}")`);
      continue;
    }
    const num = id.slice(5);
    if (!new RegExp(`^FEAT-${num}(-|$)`).test(dirName)) {
      report.error(fRel, `folder "${dirName}" must start with ${id}`);
    }
    if (!data.title) report.error(fRel, 'front matter "title" is required');
    if (!FEATURE_STATUSES.includes(data.status)) {
      report.error(fRel, `front matter "status" must be one of ${FEATURE_STATUSES.join('|')}`);
    }
    if (!FEATURE_TYPES.includes(data.type)) {
      report.error(fRel, `front matter "type" must be one of ${FEATURE_TYPES.join('|')}`);
    }
    if (!['yes', 'no'].includes(data.ui)) {
      report.error(fRel, 'front matter "ui" must be yes|no (does the feature change a screen?)');
    }
    define(id, 'feature', fRel, 1, { dir, status: data.status });

    const secs = sections(body, bodyOffsetLines);
    for (const required of FEATURE_SECTIONS) {
      const s = secs.find((x) => normHeading(x.heading) === normHeading(required));
      if (!s) report.error(fRel, `missing section "## ${required}"`);
      else if (!s.content)
        report.error(
          fRel,
          `section "## ${required}" is empty (write "N/A — <reason>" if it does not apply)`,
          s.line,
        );
    }

    // Acceptance criteria: "- **FEAT-001-AC01** …"
    const acs = [];
    const acSection = secs.find(
      (x) => normHeading(x.heading) === normHeading("Critères d'acceptation"),
    );
    if (acSection) {
      acSection.content.split('\n').forEach((l, i) => {
        const m = /^\s*-\s+\*\*(FEAT-\d{3}-AC\d{2})\*\*/.exec(l);
        if (!m) return;
        const line = acSection.line + 1 + i;
        if (!m[1].startsWith(`${id}-`)) report.error(fRel, `${m[1]} defined in ${id}`, line);
        define(m[1], 'ac', fRel, line, { feature: id });
        acs.push(m[1]);
      });
      if (acs.length === 0)
        report.error(
          fRel,
          `no acceptance criterion (expected "- **${id}-AC01** …")`,
          acSection.line,
        );
    }

    // Visual references table.
    const visSection = secs.find(
      (x) => normHeading(x.heading) === normHeading('Références visuelles'),
    );
    const visIds = [];
    if (visSection) {
      const rows = tableRows(visSection.content).filter((c) => /^FEAT-\d{3}-VIS\d{2}$/.test(c[0]));
      for (const cells of rows) {
        const [visId, source, , nature, , , , criteria, authority] = cells;
        const line =
          visSection.line + 1 + visSection.content.split('\n').findIndex((l) => l.includes(visId));
        if (cells.length < 9) {
          report.error(
            fRel,
            `${visId}: visual reference row needs 9 columns (see _templates/feature.md)`,
            line,
          );
          continue;
        }
        define(visId, 'vis', fRel, line, { feature: id });
        visIds.push(visId);
        if (!VIS_NATURES.includes(nature))
          report.error(fRel, `${visId}: nature must be ${VIS_NATURES.join('|')}`, line);
        if (!VIS_AUTHORITIES.includes(authority))
          report.error(fRel, `${visId}: authority must be ${VIS_AUTHORITIES.join('|')}`, line);
        if (authority === 'faisant-foi' && nature !== 'attendu') {
          report.error(
            fRel,
            `${visId}: only an "attendu" reference can be "faisant-foi" — a current-state or inspiration image is never an approved target`,
            line,
          );
        }
        if (!/FEAT-\d{3}-AC\d{2}/.test(criteria ?? ''))
          report.error(fRel, `${visId}: must name the acceptance criteria it supports`, line);
        checkAsset(report, fRel, dir, source.replace(/^`|`$/g, ''), line);
      }
    }
    if (data.ui === 'yes' && visIds.length === 0) {
      const msg = 'ui: yes but no visual reference (FEAT-xxx-VISnn)';
      if (data.type === 'change' || data.type === 'bugfix')
        report.error(
          fRel,
          `${msg} — a change to an existing screen needs a current-state and an expected-state reference`,
        );
      else report.warn(fRel, msg);
    }
    checkInlineImages(report, fRel, dir, body, bodyOffsetLines);
    collectRefs(body, fRel, bodyOffsetLines);

    features.push({ id, dir, dirName, file: fRel, status: data.status, acs, visIds, specs: [] });
  }

  // Specs, clarifications, briefs, other artifacts.
  for (const feature of features) {
    const specFiles = walk(join(feature.dir, 'specs'), (f) => f.endsWith('.md'));
    for (const specFile of specFiles) {
      const sRel = rel(specFile);
      const text = read(specFile);
      const { data, body, bodyOffsetLines } = parseFrontMatter(text);
      if (!data) {
        report.error(sRel, 'missing front matter (--- id/feature/title/status/version/covers ---)');
        continue;
      }
      const sid = data.id;
      const num = feature.id.slice(5);
      if (!new RegExp(`^SPEC-${num}-\\d{2}$`).test(sid ?? '')) {
        report.error(sRel, `front matter "id" must look like SPEC-${num}-01 (got "${sid ?? ''}")`);
        continue;
      }
      if (!specFile.endsWith(`${sid}.md`)) report.error(sRel, `file name must be ${sid}.md`);
      if (data.feature !== feature.id)
        report.error(sRel, `"feature" must be ${feature.id} (got "${data.feature ?? ''}")`);
      if (!data.title) report.error(sRel, 'front matter "title" is required');
      if (!SPEC_STATUSES.includes(data.status))
        report.error(sRel, `"status" must be one of ${SPEC_STATUSES.join('|')}`);
      const version = Number(data.version);
      if (!Number.isInteger(version) || version < 1)
        report.error(
          sRel,
          '"version" must be an integer ≥ 1 (bump it whenever a clarified spec changes)',
        );
      const covers = Array.isArray(data.covers) ? data.covers : [];
      if (covers.length === 0)
        report.error(
          sRel,
          '"covers" must list the acceptance criteria this spec covers, e.g. [FEAT-001-AC01]',
        );
      for (const ac of covers) {
        if (!feature.acs.includes(ac))
          report.error(sRel, `covers ${ac}, which is not an acceptance criterion of ${feature.id}`);
      }
      define(sid, 'spec', sRel, 1, { feature: feature.id, status: data.status, version });

      const secs = sections(body, bodyOffsetLines);
      for (const required of SPEC_SECTIONS) {
        const s = secs.find((x) => normHeading(x.heading) === normHeading(required));
        if (!s) report.error(sRel, `missing section "## ${required}"`);
        else if (!s.content)
          report.error(
            sRel,
            `section "## ${required}" is empty (write "N/A — <reason>" if it does not apply)`,
            s.line,
          );
      }

      // Scenarios: "### SPEC-001-01-SC01 — title" + Given/When/Then + criteria.
      const scenarios = [];
      const lines = body.split('\n');
      lines.forEach((l, i) => {
        const m = /^#{3,4}\s+(SPEC-\d{3}-\d{2}-SC\d{2})\b(.*)$/.exec(l);
        if (!m) return;
        const line = i + 1 + bodyOffsetLines;
        if (!m[1].startsWith(`${sid}-`)) report.error(sRel, `${m[1]} defined in ${sid}`, line);
        const end = lines.findIndex((x, j) => j > i && /^#{2,4}\s/.test(x));
        const block = lines.slice(i + 1, end === -1 ? undefined : end).join('\n');
        const evidence = /\[evidence:\s*(manual|review)\]/.exec(m[2])?.[1] ?? 'test';
        define(m[1], 'scenario', sRel, line, { spec: sid, evidence });
        for (const [label, re] of [
          ['Étant donné/Given', /\*\*(Étant donné|Given)\*\*/i],
          ['Quand/When', /\*\*(Quand|When)\*\*/i],
          ['Alors/Then', /\*\*(Alors|Then)\*\*/i],
        ]) {
          if (!re.test(block)) report.error(sRel, `${m[1]}: missing **${label}** step`, line);
        }
        const acRefs = [...block.matchAll(/FEAT-\d{3}-AC\d{2}/g)].map((x) => x[0]);
        scenarios.push({ id: m[1], line, evidence, acs: [...new Set(acRefs)] });
        if (acRefs.length === 0)
          report.error(sRel, `${m[1]}: must name the acceptance criteria it verifies`, line);
        for (const ac of acRefs) {
          if (!covers.includes(ac))
            report.error(
              sRel,
              `${m[1]}: verifies ${ac}, which is not in this spec's "covers"`,
              line,
            );
        }
      });
      if (scenarios.length === 0)
        report.error(sRel, `no scenario (expected "### ${sid}-SC01 — …")`);

      checkInlineImages(report, sRel, dirname(specFile), body, bodyOffsetLines);
      collectRefs(body, sRel, bodyOffsetLines);
      feature.specs.push({ id: sid, file: sRel, status: data.status, version, covers, scenarios });
    }

    // Clarifications: | FEAT-001-Q01 | question | bloquant oui/non | statut | décision | specs |
    const clarFile = join(feature.dir, 'clarifications.md');
    const blockingOpen = [];
    if (existsSync(clarFile)) {
      const cRel = rel(clarFile);
      const text = read(clarFile);
      const rows = tableRows(text).filter((c) => /^FEAT-\d{3}-Q\d{2}$/.test(c[0]));
      for (const cells of rows) {
        const [qid, , blocking, status, decision, specsCell] = cells;
        const line = text.split('\n').findIndex((l) => l.includes(`| ${qid} `)) + 1;
        if (cells.length < 6) {
          report.error(cRel, `${qid}: clarification row needs 6 columns`, line);
          continue;
        }
        define(qid, 'question', cRel, line, { feature: feature.id });
        if (!['oui', 'non'].includes(blocking))
          report.error(cRel, `${qid}: "bloquant" must be oui|non`, line);
        if (!['ouverte', 'tranchée', 'hypothèse'].includes(status))
          report.error(cRel, `${qid}: "statut" must be ouverte|tranchée|hypothèse`, line);
        if (status !== 'ouverte' && !decision)
          report.error(cRel, `${qid}: a ${status} question must record its decision`, line);
        if (blocking === 'oui' && status === 'hypothèse')
          report.error(
            cRel,
            `${qid}: a blocking product question cannot be settled by an assumption — it needs a human decision`,
            line,
          );
        // A blocking question explicitly deferred out of scope ("hors périmètre")
        // is recorded for follow-up but does not gate this feature's specs.
        const deferred = /hors[ -]p[ée]rim[èe]tre/i.test(specsCell ?? '');
        if (blocking === 'oui' && status === 'ouverte' && !deferred) {
          const specIds = [...(specsCell ?? '').matchAll(/SPEC-\d{3}-\d{2}/g)].map((x) => x[0]);
          blockingOpen.push({ qid, specIds });
        }
      }
      collectRefs(text, cRel);
    }
    for (const spec of feature.specs) {
      if (spec.status === 'draft') continue;
      if (!existsSync(clarFile)) {
        report.error(
          spec.file,
          `status "${spec.status}" requires ${feature.dirName}/clarifications.md (run the grill-me stage)`,
        );
      }
      for (const q of blockingOpen) {
        if (q.specIds.length === 0 || q.specIds.includes(spec.id)) {
          report.error(
            spec.file,
            `status "${spec.status}" but blocking question ${q.qid} is still open`,
          );
        }
      }
    }

    // Execution brief pins spec versions: "specs: [SPEC-001-01@2]".
    const briefFile = join(feature.dir, 'brief.md');
    if (existsSync(briefFile)) {
      const bRel = rel(briefFile);
      const text = read(briefFile);
      const { data } = parseFrontMatter(text);
      const pins = Array.isArray(data?.specs) ? data.specs : [];
      if (pins.length === 0)
        report.error(bRel, 'front matter "specs" must pin spec versions, e.g. [SPEC-001-01@1]');
      for (const pin of pins) {
        const m = /^(SPEC-\d{3}-\d{2})@(\d+)$/.exec(pin);
        if (!m) {
          report.error(bRel, `invalid pin "${pin}" (expected SPEC-001-01@1)`);
          continue;
        }
        const spec = feature.specs.find((s) => s.id === m[1]);
        if (!spec) report.error(bRel, `pins unknown spec ${m[1]}`);
        else if (spec.version !== Number(m[2])) {
          report.error(
            bRel,
            `pins ${m[1]}@${m[2]} but the spec is now version ${spec.version} — the brief is stale, regenerate it`,
          );
        }
      }
      for (const spec of feature.specs) {
        if (spec.status !== 'draft' && !pins.some((p) => p.startsWith(`${spec.id}@`))) {
          report.error(bRel, `does not pin ${spec.id} (status ${spec.status})`);
        }
      }
      collectRefs(text, bRel);
    } else if (feature.specs.some((s) => s.status === 'implemented')) {
      report.error(feature.file, 'has an implemented spec but no brief.md');
    }

    // Every other markdown artifact of the feature: references + images.
    for (const f of walk(feature.dir, (x) => x.endsWith('.md'))) {
      const r = rel(f);
      if (r === feature.file || /\/specs\//.test(r) || /\/(clarifications|brief)\.md$/.test(r))
        continue;
      const text = read(f);
      checkInlineImages(report, r, dirname(f), text, 0);
      collectRefs(text, r);
    }

    // Coverage of acceptance criteria by specs.
    for (const ac of feature.acs) {
      if (!feature.specs.some((s) => s.covers.includes(ac))) {
        if (feature.status === 'draft')
          report.warn(feature.file, `${ac} is not covered by any spec yet`);
        else
          report.error(
            feature.file,
            `${ac} is not covered by any spec (feature status "${feature.status}")`,
          );
      }
    }
  }

  // Test files referencing scenario IDs.
  const testRefs = new Map(); // scenarioId -> Set(files)
  for (const f of listSourceFiles(root)) {
    if (!TEST_FILE.test(f) || f.startsWith('scripts/pipeline/')) continue;
    const text = read(join(root, f));
    for (const m of text.matchAll(ID_TOKEN)) {
      refs.push({ id: m[1], file: f, line: lineOf(text, m.index) });
      if (m[1].includes('-SC')) {
        if (!testRefs.has(m[1])) testRefs.set(m[1], new Set());
        testRefs.get(m[1]).add(f);
      }
    }
  }

  for (const r of refs) {
    if (!defs.has(r.id))
      report.error(r.file, `broken reference: ${r.id} is not defined anywhere`, r.line);
  }

  for (const feature of features) {
    for (const spec of feature.specs) {
      for (const sc of spec.scenarios) {
        const mapped = testRefs.get(sc.id);
        if (sc.evidence !== 'test') {
          report.warn(
            spec.file,
            `${sc.id}: evidence is "${sc.evidence}", not an automated test — the review must check it`,
            sc.line,
          );
          continue;
        }
        if (mapped && mapped.size > 0) continue;
        if (spec.status === 'implemented')
          report.error(
            spec.file,
            `${sc.id}: status "implemented" but no test references this scenario`,
            sc.line,
          );
        else if (spec.status === 'clarified')
          report.warn(spec.file, `${sc.id}: no test mapped yet`, sc.line);
      }
    }
  }

  return { report, model: { features, testRefs } };
}

function checkAsset(report, file, dir, source, line) {
  if (!source || source === 'N/A') {
    report.error(file, 'visual reference without a source path or URL', line);
    return;
  }
  if (/^https?:\/\//.test(source)) {
    report.warn(
      file,
      `remote visual reference ${source} — not versioned, may disappear; prefer a file under assets/`,
      line,
    );
    return;
  }
  if (!existsSync(resolve(dir, source))) report.error(file, `missing asset: ${source}`, line);
}

function checkInlineImages(report, file, dir, text, offset) {
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    checkAsset(report, file, dir, m[1], lineOf(text, m.index) + offset);
  }
}

function printMatrix(model, featureId) {
  const feature = model.features.find((f) => f.id === featureId);
  if (!feature) {
    console.error(`unknown feature ${featureId}`);
    return 1;
  }
  console.log(`| Critère | Spec (version) | Scénario | Preuve |`);
  console.log(`| --- | --- | --- | --- |`);
  for (const spec of feature.specs) {
    for (const sc of spec.scenarios) {
      const files = [...(model.testRefs.get(sc.id) ?? [])];
      const evidence =
        sc.evidence !== 'test'
          ? `_${sc.evidence}_`
          : files.length
            ? files.map((f) => `\`${f}\``).join('<br>')
            : '**aucune**';
      console.log(
        `| ${sc.acs.join(', ')} | ${spec.id}@${spec.version} (${spec.status}) | ${sc.id} | ${evidence} |`,
      );
    }
  }
  return 0;
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { root: process.cwd() });
  const { report, model } = checkSpecs({ root: resolve(args.root) });
  if (args.matrix) {
    report.print({ json: false });
    process.exitCode = printMatrix(model, args.matrix) || report.exitCode;
  } else {
    report.print({ json: args.json });
    process.exitCode = report.exitCode;
  }
}
