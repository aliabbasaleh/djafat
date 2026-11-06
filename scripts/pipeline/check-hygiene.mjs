#!/usr/bin/env node
// Test and suppression hygiene (docs/pipeline/quality-rules.md §Hygiène).
//
//   node scripts/pipeline/check-hygiene.mjs
//   node scripts/pipeline/check-hygiene.mjs --update-baseline --reason "<why>"
//   node scripts/pipeline/check-hygiene.mjs --root <dir> --baseline <file>
//
// Rules (all errors unless baselined):
//   focused-test        it.only / describe.only / test.only / fit / fdescribe — never allowed, never baselined
//   unapproved-skip     .skip / .todo / xit / xdescribe without `skip-approved: <reason>` on the line or the line above
//   unjustified-disable eslint-disable… without ` -- <reason>`
//   ts-ignore           @ts-ignore / @ts-nocheck (use @ts-expect-error with a description)
import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMainModule, listSourceFiles, parseArgs, read, Report } from './lib/common.mjs';

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /(\.spec|\.test|\.int\.spec)\.[cm]?[jt]sx?$|(^|\/)e2e\//;

const RULES = [
  {
    id: 'focused-test',
    test: true,
    re: /\b(?:it|test|describe|suite|bench)\.only\s*\(|\b(?:fit|fdescribe)\s*\(/,
    message: 'focused test: it/describe/test.only silently disables every other test of the run',
    baselinable: false,
  },
  {
    id: 'unapproved-skip',
    test: true,
    re: /\b(?:it|test|describe|suite)\.(?:skip|todo|skipIf)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(/,
    message:
      'skipped test without approval: add `// skip-approved: <reason / ticket>` on the line or the line above',
    approved: /skip-approved:\s*\S/,
    baselinable: true,
  },
  {
    id: 'unjustified-disable',
    test: false,
    re: /eslint-disable(?:-next-line|-line)?\b/,
    ok: /eslint-disable(?:-next-line|-line)?\s+[^\n]*?\s--\s+\S/,
    message:
      'eslint-disable without a justification: write `eslint-disable-next-line <rule> -- <reason>`',
    baselinable: true,
  },
  {
    id: 'ts-ignore',
    test: false,
    re: /@ts-(?:ignore|nocheck)\b/,
    message:
      '@ts-ignore / @ts-nocheck hide every error on the line/file: use `@ts-expect-error <reason>`',
    baselinable: true,
  },
];

function isInComment(line, re) {
  const at = line.search(re);
  const comment = Math.min(
    ...['//', '/*'].map((t) => line.indexOf(t)).filter((i) => i >= 0),
    Infinity,
  );
  return at >= 0 && (comment <= at || /^\s*\*/.test(line));
}

export function findingKey(f) {
  return `${f.rule}|${f.file}|${f.text}`;
}

export function checkHygiene({ root, baselinePath }) {
  const report = new Report('check-hygiene');
  const findings = [];
  for (const file of listSourceFiles(root)) {
    // scripts/pipeline/ quotes these patterns in its own rules and fixtures.
    if (!CODE.test(file) || file.startsWith('scripts/pipeline/')) continue;
    const isTest = TEST.test(file);
    const lines = read(join(root, file)).split('\n');
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.test && !isTest) continue;
        if (!rule.re.test(line)) continue;
        if (rule.ok && rule.ok.test(line)) continue;
        if (rule.approved && (rule.approved.test(line) || rule.approved.test(lines[i - 1] ?? '')))
          continue;
        // Directives only count inside a comment (not a quoted pattern).
        if (!rule.test && !isInComment(line, rule.re)) continue;
        findings.push({
          rule: rule.id,
          file,
          line: i + 1,
          text: line.trim(),
          baselinable: rule.baselinable,
          message: rule.message,
        });
      }
    });
  }

  const baseline =
    baselinePath && existsSync(baselinePath) ? JSON.parse(read(baselinePath)) : { findings: [] };
  const known = new Set(baseline.findings.map(findingKey));
  let preExisting = 0;
  for (const f of findings) {
    if (f.baselinable && known.has(findingKey(f))) {
      preExisting += 1;
      continue;
    }
    report.error(f.file, `[${f.rule}] ${f.message}`, f.line);
  }
  const current = new Set(findings.map(findingKey));
  for (const b of baseline.findings) {
    if (!current.has(findingKey(b)))
      report.warn(
        baselinePath,
        `baseline entry fixed, remove it: [${b.rule}] ${b.file}: ${b.text}`,
      );
  }
  return { report, findings, preExisting };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), {
    root: process.cwd(),
    baseline: 'scripts/pipeline/baselines/hygiene.json',
  });
  const root = resolve(args.root);
  const baselinePath = resolve(root, args.baseline);
  const { report, findings, preExisting } = checkHygiene({ root, baselinePath });
  if (args['update-baseline']) {
    const reason = typeof args.reason === 'string' ? args.reason : 'TODO: justify';
    const keep = findings
      .filter((f) => f.baselinable)
      .map(({ rule, file, text }) => ({ rule, file, text, reason }));
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ $comment: 'Pre-existing hygiene findings accepted explicitly; new ones are rejected. Focused tests are never baselinable.', findings: keep }, null, 2)}\n`,
    );
    console.log(`baseline written: ${keep.length} finding(s)`);
  } else {
    if (preExisting > 0)
      console.log(`check-hygiene: ${preExisting} pre-existing (baselined) finding(s) tolerated`);
    report.print({ json: args.json });
    process.exitCode = report.exitCode;
  }
}
