#!/usr/bin/env node
// Deterministic architecture checks (docs/pipeline/architecture-policy.md).
//
//   node scripts/pipeline/check-arch.mjs                  # check vs baseline
//   node scripts/pipeline/check-arch.mjs --update-baseline  # rewrite baseline (review the diff!)
//   node scripts/pipeline/check-arch.mjs --root <dir> --baseline <file>  # fixtures
//
// Two complementary mechanisms, neither replaces the other:
//   1. dependency-cruiser on the FULL graph of every project (cycles, layer
//      direction, private internals, prod->test, unresolvable internal edges);
//   2. layer classification: every backend/domain/frontend source file must
//      match a layer, so a new file cannot silently escape the policy.
// The backend module DAG itself stays in ESLint (eslint-plugin-boundaries,
// packages/eslint-config/api-boundaries.js) — not duplicated here.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cruise } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import {
  CLASSIFIED_ROOTS,
  FORBIDDEN,
  LAYERS,
  PROJECTS as DEFAULT_PROJECTS,
} from './architecture/policy.mjs';
import { isMainModule, listSourceFiles, parseArgs, read, Report, toPosix } from './lib/common.mjs';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** `@djafat/<pkg>` -> packages/<pkg>/src/index.ts(x), so no build is needed. */
function workspaceAliases(root) {
  const alias = {};
  const pkgDir = join(root, 'packages');
  if (!existsSync(pkgDir)) return alias;
  for (const name of readdirSync(pkgDir)) {
    const pj = join(pkgDir, name, 'package.json');
    if (!existsSync(pj)) continue;
    const pkgName = JSON.parse(read(pj)).name;
    for (const entry of ['src/index.ts', 'src/index.tsx']) {
      const full = join(pkgDir, name, entry);
      if (existsSync(full)) {
        alias[`${pkgName}$`] = full;
        break;
      }
    }
  }
  return alias;
}

function expandPaths(root, paths) {
  const out = [];
  for (const p of paths) {
    if (p.includes('*')) {
      const [head, tail] = p.split('*');
      const dir = join(root, head);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const candidate = `${head}${name}${tail}`;
        if (existsSync(join(root, candidate))) out.push(candidate);
      }
    } else if (existsSync(join(root, p))) out.push(p);
  }
  return out;
}

export function violationKey(v) {
  return v.cycle
    ? `${v.rule}|cycle|${[...v.cycle].sort().join('>')}`
    : `${v.rule}|${v.from}|${v.to}`;
}

/**
 * @param {{ root: string, baselinePath?: string, projects?: object[] }} opts
 */
export async function checkArch({ root, baselinePath, projects = DEFAULT_PROJECTS }) {
  const report = new Report('check-arch');
  const alias = workspaceAliases(root);
  const violations = new Map();
  const ruleComment = new Map(FORBIDDEN.map((r) => [r.name, r.comment]));
  const previousCwd = process.cwd();
  process.chdir(root); // dependency-cruiser reports paths relative to cwd
  try {
    for (const project of projects) {
      const paths = expandPaths(root, project.paths);
      if (paths.length === 0) continue;
      const tsConfigFile =
        project.tsConfig && existsSync(join(root, project.tsConfig)) ? project.tsConfig : null;
      const result = await cruise(
        paths,
        {
          validate: true,
          ruleSet: { forbidden: FORBIDDEN },
          doNotFollow: { path: 'node_modules' },
          exclude: { path: '(^|/)(node_modules|dist|build|\\.next|\\.expo|coverage)/|\\.d\\.ts$' },
          tsPreCompilationDeps: true,
          moduleSystems: ['es6', 'cjs', 'tsd'],
          combinedDependencies: true,
          ...(tsConfigFile ? { tsConfig: { fileName: tsConfigFile } } : {}),
          enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['types', 'import', 'require', 'node', 'default'],
            extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
            mainFields: ['types', 'module', 'main'],
          },
        },
        { alias: project.atAlias ? { ...alias, '@': join(root, project.atAlias) } : alias },
        tsConfigFile ? { tsConfig: extractTSConfig(join(root, tsConfigFile)) } : {},
      );
      const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
      for (const v of output.summary.violations ?? []) {
        const entry = {
          rule: v.rule.name,
          from: toPosix(v.from),
          to: toPosix(v.to),
          ...(v.cycle
            ? { cycle: v.cycle.map((c) => toPosix(typeof c === 'string' ? c : c.name)) }
            : {}),
          project: project.name,
        };
        violations.set(violationKey(entry), entry);
      }
    }
  } finally {
    process.chdir(previousCwd);
  }

  // Layer classification.
  const classifiedRoots = new RegExp(CLASSIFIED_ROOTS);
  const layers = LAYERS.map((l) => ({ ...l, re: new RegExp(l.pattern) }));
  const unclassified = [];
  for (const f of listSourceFiles(root)) {
    if (!SOURCE_EXT.test(f) || f.endsWith('.d.ts') || !classifiedRoots.test(f)) continue;
    if (!layers.some((l) => l.re.test(f))) unclassified.push(f);
  }

  const baseline =
    baselinePath && existsSync(baselinePath)
      ? JSON.parse(read(baselinePath))
      : { violations: [], unclassified: [] };
  const knownViolations = new Set(baseline.violations.map(violationKey));
  const knownUnclassified = new Set(baseline.unclassified.map((u) => u.path ?? u));

  let preExisting = 0;
  for (const [key, v] of violations) {
    if (knownViolations.has(key)) {
      preExisting += 1;
      continue;
    }
    const where = v.cycle ? v.cycle.join(' -> ') : `${v.from} -> ${v.to}`;
    report.error(v.from, `[${v.rule}] ${where}\n          why: ${ruleComment.get(v.rule) ?? ''}`);
  }
  for (const f of unclassified) {
    if (knownUnclassified.has(f)) {
      preExisting += 1;
      continue;
    }
    report.error(
      f,
      '[unclassified-file] matches no layer of the architecture policy — give it a role suffix (.service.ts, .controller.ts, …) or a folder the policy classifies, or extend LAYERS in scripts/pipeline/architecture/policy.mjs with a reviewed rule',
    );
  }
  // Ratchet: baseline entries that no longer occur must be removed.
  for (const v of baseline.violations) {
    if (!violations.has(violationKey(v)))
      report.warn(
        baselinePath,
        `baseline entry fixed, remove it: [${v.rule}] ${v.from} -> ${v.to ?? ''}`,
      );
  }
  for (const u of baseline.unclassified) {
    const p = u.path ?? u;
    if (!unclassified.includes(p))
      report.warn(baselinePath, `baseline entry fixed, remove it: [unclassified-file] ${p}`);
  }

  return { report, violations: [...violations.values()], unclassified, preExisting };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), {
    root: process.cwd(),
    baseline: 'scripts/pipeline/baselines/architecture.json',
  });
  const root = resolve(args.root);
  const baselinePath = resolve(root, args.baseline);
  const { report, violations, unclassified, preExisting } = await checkArch({ root, baselinePath });
  if (args['update-baseline']) {
    const reason = typeof args.reason === 'string' ? args.reason : 'TODO: justify';
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          $comment:
            'Pre-existing architecture debt, accepted explicitly. New violations are rejected. Remove an entry as soon as it is fixed (check-arch warns). See docs/pipeline/architecture-policy.md §Dette.',
          violations: violations.map(({ project: _p, ...v }) => ({ ...v, reason })),
          unclassified: unclassified.map((path) => ({ path, reason })),
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `baseline written: ${violations.length} violation(s), ${unclassified.length} unclassified file(s)`,
    );
  } else {
    if (preExisting > 0)
      console.log(`check-arch: ${preExisting} pre-existing (baselined) finding(s) tolerated`);
    report.print({ json: args.json });
    process.exitCode = report.exitCode;
  }
}
