#!/usr/bin/env node
// Production dependency advisories vs an explicit baseline
// (docs/pipeline/quality-rules.md §Dépendances).
//
//   node scripts/pipeline/check-audit.mjs                       # runs `pnpm audit --prod --json`
//   node scripts/pipeline/check-audit.mjs --input audit.json    # fixtures / offline replay
//   node scripts/pipeline/check-audit.mjs --update-baseline --reason "<why>"
//
// Exit 0 = no advisory beyond the baseline, 1 = NEW advisory (introduced by a
// change), 2 = audit unavailable (network / registry): verify reports it as
// "unavailable", never as passing.
//
// Why: the plain `pnpm audit --audit-level high` job is red on pre-existing
// Expo advisories, so a NEW vulnerable dependency was indistinguishable from
// the old debt (FEAT-007 added nodemailer@8.0.11 with 15 advisories and CI
// stayed "the same red").
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule, parseArgs, read, Report } from './lib/common.mjs';

export function advisoryKeys(auditJson) {
  const advisories = Object.values(auditJson?.advisories ?? {});
  return advisories.map((a) => ({
    key: `${a.github_advisory_id ?? a.id}|${a.module_name}`,
    module: a.module_name,
    severity: a.severity,
    title: a.title,
    patched: a.patched_versions,
  }));
}

export function compareAudit(current, baselineKeys) {
  const known = new Set(baselineKeys);
  const now = new Set(current.map((a) => a.key));
  return {
    added: current.filter((a) => !known.has(a.key)),
    fixed: [...known].filter((k) => !now.has(k)),
  };
}

// An audit report without an `advisories` object (registry error payload, empty
// or truncated output) is "unavailable", never "zero advisories" — fail closed.
export function parseAudit(text) {
  try {
    const json = JSON.parse(text);
    return json && typeof json.advisories === 'object' && json.advisories !== null ? json : null;
  } catch {
    return null;
  }
}

function runAudit(root) {
  const r = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  return parseAudit(r.stdout ?? '');
}

if (isMainModule(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), {
    root: process.cwd(),
    baseline: 'scripts/pipeline/baselines/audit.json',
  });
  const root = resolve(args.root);
  const baselinePath = resolve(root, args.baseline);
  const json =
    typeof args.input === 'string' ? parseAudit(read(resolve(root, args.input))) : runAudit(root);
  if (!json) {
    console.error('check-audit: audit unavailable (registry unreachable?) — NOT a pass');
    process.exit(2);
  }
  const current = advisoryKeys(json);
  if (args['update-baseline']) {
    const reason = typeof args.reason === 'string' ? args.reason : 'TODO: justify';
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          $comment:
            'Pre-existing production advisories accepted explicitly; any advisory not listed here fails check:audit. Remove entries as upgrades fix them (check:audit warns).',
          reason,
          advisories: current.map((a) => a.key).sort(),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`baseline written: ${current.length} advisory(ies)`);
    process.exit(0);
  }
  const baseline = existsSync(baselinePath) ? JSON.parse(read(baselinePath)) : { advisories: [] };
  const { added, fixed } = compareAudit(current, baseline.advisories);
  const report = new Report('check-audit');
  for (const a of added) {
    report.error(
      a.module,
      `NEW ${a.severity} advisory: ${a.title} (fixed in ${a.patched}) [${a.key}]`,
    );
  }
  for (const k of fixed)
    report.warn(baselinePath, `baseline advisory no longer present, remove it: ${k}`);
  console.log(
    `check-audit: ${current.length} advisory(ies), ${current.length - added.length} pre-existing (baselined)`,
  );
  report.print({ json: args.json });
  process.exitCode = report.exitCode;
}
