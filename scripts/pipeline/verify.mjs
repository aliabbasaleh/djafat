#!/usr/bin/env node
// Single verification entry point (docs/pipeline/README.md §Commandes).
//
//   pnpm verify:fast                 # scoped to what changed vs HEAD (+ graph-wide checks)
//   pnpm verify                      # full verification, reproducible from a clean checkout
//   node scripts/pipeline/verify.mjs --full --report <file.md>   # also write a markdown report
//   node scripts/pipeline/verify.mjs --fast --only lint,arch     # subset
//
// It only ORCHESTRATES existing commands (prettier, turbo lint/typecheck/test/
// build, the pipeline checks). Every result is classified:
//   pass · FAIL (new) · fail (pre-existing, baselined) · skipped · unavailable
// Exit code 1 iff at least one NEW failure. A run with pre-existing failures or
// unavailable checks is never reported as "all green".
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs, read } from './lib/common.mjs';

const root = resolve(process.cwd());
const args = parseArgs(process.argv.slice(2), { root });
const mode = args.full ? 'full' : 'fast';
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const knownFailures = JSON.parse(
  read(join(root, 'scripts/pipeline/baselines/known-failures.json')),
);

const results = [];
const record = (r) => {
  results.push(r);
  const icon = {
    pass: 'ok  ',
    fail: 'FAIL',
    preexisting: 'old ',
    skipped: 'skip',
    unavailable: 'n/a ',
  }[r.status];
  console.log(`[${icon}] ${r.id}${r.detail ? ` — ${r.detail}` : ''}`);
};

function git(argv) {
  const r = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function run(cmd, argv, { timeoutMs = 20 * 60_000, env = {} } = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, argv, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      FORCE_COLOR: '0',
      ...env,
    },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    code: r.error?.code === 'ETIMEDOUT' ? 124 : (r.status ?? 1),
    timedOut: r.error?.code === 'ETIMEDOUT',
    output,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

function tail(output, n = 25) {
  return output.trimEnd().split('\n').slice(-n).join('\n');
}

const wanted = (id) => !only || only.has(id);

/** Plain command: pass / FAIL (known failures for whole commands are listed in the baseline). */
function step(id, cmd, argv, opts = {}) {
  if (!wanted(id)) return;
  const r = run(cmd, argv, opts);
  if (r.code === 0) return record({ id, status: 'pass', detail: `${r.seconds}s` });
  const known = knownFailures.commands?.[id];
  record({
    id,
    status: known ? 'preexisting' : 'fail',
    detail: r.timedOut
      ? `timed out after ${r.seconds}s`
      : known
        ? `${known.reason} (${known.ref})`
        : `exit ${r.code}`,
    log: tail(r.output),
  });
}

/** turbo task(s) with per-task classification against the known-failures baseline. */
function turboStep(id, tasks, filterArgs = []) {
  if (!wanted(id)) return;
  const runsDir = join(root, '.turbo', 'runs');
  rmSync(runsDir, { recursive: true, force: true });
  const r = run('pnpm', [
    'exec',
    'turbo',
    'run',
    ...tasks,
    '--continue',
    '--summarize',
    ...filterArgs,
  ]);
  const summaryFile = existsSync(runsDir)
    ? readdirSync(runsDir)
        .map((f) => join(runsDir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : null;
  if (!summaryFile) {
    // turbo itself failed before running tasks (bad filter, config error…)
    if (/No package found|no packages? (matched|found)|0 total/i.test(r.output) && r.code === 0) {
      return record({ id, status: 'skipped', detail: 'no affected package' });
    }
    return record({
      id,
      status: r.code === 0 ? 'pass' : 'fail',
      detail: `turbo exit ${r.code} (no run summary)`,
      log: tail(r.output),
    });
  }
  const summary = JSON.parse(read(summaryFile));
  rmSync(runsDir, { recursive: true, force: true });
  if (summary.tasks.length === 0)
    return record({ id, status: 'skipped', detail: 'no affected package' });
  const failed = summary.tasks
    .filter((t) => t.execution && t.execution.exitCode !== 0)
    .map((t) => t.taskId);
  const knownTasks = knownFailures.tasks ?? {};
  const newFailures = failed.filter((t) => !knownTasks[t]);
  const oldFailures = failed.filter((t) => knownTasks[t]);
  const nowPassing = summary.tasks
    .filter((t) => knownTasks[t.taskId] && t.execution?.exitCode === 0)
    .map((t) => t.taskId);
  const total = summary.tasks.length;
  if (newFailures.length > 0) {
    const logs = newFailures
      .map((t) => {
        const prefix = `${t.replace('#', ':')}:`;
        return r.output
          .split('\n')
          .filter((l) => l.startsWith(prefix))
          .slice(-20)
          .join('\n');
      })
      .join('\n');
    record({
      id,
      status: 'fail',
      detail: `${total - failed.length}/${total} tasks ok — NEW failure(s): ${newFailures.join(', ')}${oldFailures.length ? `; pre-existing: ${oldFailures.join(', ')}` : ''}`,
      log: logs || tail(r.output),
    });
  } else if (oldFailures.length > 0) {
    record({
      id,
      status: 'preexisting',
      detail: `${total - failed.length}/${total} tasks ok — pre-existing failure(s) only: ${oldFailures.map((t) => `${t} (${knownTasks[t].ref})`).join(', ')}`,
    });
  } else {
    record({ id, status: 'pass', detail: `${total}/${total} tasks ok` });
  }
  for (const t of nowPassing) {
    console.log(
      `       note: ${t} is listed as a known failure but now PASSES — remove it from scripts/pipeline/baselines/known-failures.json`,
    );
  }
}

function canConnect(url) {
  return new Promise((done) => {
    try {
      const u = new URL(url);
      const socket = createConnection({
        host: u.hostname,
        port: Number(u.port) || (u.protocol.startsWith('redis') ? 6379 : 5432),
      });
      const finish = (ok) => {
        socket.destroy();
        done(ok);
      };
      socket.setTimeout(1500, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    } catch {
      done(false);
    }
  });
}

// ---------------------------------------------------------------------------
const head = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
console.log(
  `verify:${mode} @ ${head}${dirty ? ' (+ uncommitted changes)' : ''} — ${new Date().toISOString()}`,
);

const changed = [
  ...new Set(
    [
      ...git(['diff', '--name-only', 'HEAD']).split('\n'),
      ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
    ].filter((f) => f && existsSync(join(root, f))),
  ),
];

if (mode === 'fast') {
  const formattable = changed.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml)$/.test(f));
  if (!wanted('format')) {
    /* filtered out */
  } else if (formattable.length === 0)
    record({ id: 'format', status: 'skipped', detail: 'no changed formattable file' });
  else step('format', 'pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...formattable]);
} else {
  step('format', 'pnpm', ['format:check']);
}

// Graph-wide / repository-wide pipeline checks: cheap, always complete.
step('specs', 'node', ['scripts/pipeline/check-specs.mjs']);
step('hygiene', 'node', ['scripts/pipeline/check-hygiene.mjs']);
step('arch', 'node', ['scripts/pipeline/check-arch.mjs']);

if (mode === 'fast') {
  if (changed.length === 0) {
    for (const id of ['lint', 'typecheck', 'test:unit'])
      if (wanted(id)) record({ id, status: 'skipped', detail: 'no change vs HEAD' });
  } else {
    // `...[HEAD]` = packages changed vs HEAD (working tree) AND their dependents.
    turboStep('lint', ['lint'], ['--filter=...[HEAD]']);
    turboStep('typecheck', ['typecheck'], ['--filter=...[HEAD]']);
    turboStep('test:unit', ['test:unit'], ['--filter=...[HEAD]']);
  }
} else {
  step('pipeline-tooling', 'node', ['--test', 'scripts/pipeline/test/*.test.mjs']);
  if (wanted('prisma')) step('prisma', 'pnpm', ['--filter', '@djafat/api', 'run', 'db:generate']);
  turboStep('typecheck', ['typecheck']);
  turboStep('lint', ['lint']);
  turboStep('test', ['test']);
  turboStep('build', ['build']);

  // Network-dependent: new production advisories vs scripts/pipeline/baselines/audit.json.
  if (wanted('audit')) {
    const r = run('node', ['scripts/pipeline/check-audit.mjs'], { timeoutMs: 6 * 60_000 });
    if (r.code === 0)
      record({ id: 'audit', status: 'pass', detail: 'no advisory beyond the baseline' });
    else if (r.code === 2)
      record({
        id: 'audit',
        status: 'unavailable',
        detail: 'registry unreachable — audit not run',
      });
    else
      record({
        id: 'audit',
        status: 'fail',
        detail: 'NEW production advisory',
        log: tail(r.output),
      });
  }

  if (wanted('test:int')) {
    const db = process.env.DATABASE_URL;
    const redis = process.env.REDIS_URL;
    if (!db || !redis) {
      record({
        id: 'test:int',
        status: 'unavailable',
        detail:
          'DATABASE_URL / REDIS_URL not exported (pnpm infra:up, then export .env — docs/36 §0.1)',
      });
    } else if (!(await canConnect(db)) || !(await canConnect(redis))) {
      record({
        id: 'test:int',
        status: 'unavailable',
        detail: 'Postgres or Redis not reachable (pnpm infra:up)',
      });
    } else {
      step('test:int', 'pnpm', ['--filter', '@djafat/api', 'run', 'test:int']);
    }
  }
  if (wanted('e2e'))
    record({
      id: 'e2e',
      status: 'unavailable',
      detail: 'no versioned E2E suite yet — the 19-step pilot is a manual runbook (docs/36 §6.4)',
    });
}

// ---------------------------------------------------------------------------
const count = (s) => results.filter((r) => r.status === s).length;
const newFailures = count('fail');
const verdict =
  newFailures > 0
    ? `NEW FAILURE(S): ${newFailures}`
    : count('preexisting') + count('unavailable') > 0
      ? `no new failure — NOT all green (${count('preexisting')} pre-existing failure(s), ${count('unavailable')} unavailable, ${count('skipped')} skipped)`
      : count('skipped') > 0
        ? `all executed checks pass (${count('skipped')} skipped)`
        : 'all checks pass';
console.log(`\nverify:${mode}: ${verdict}`);
for (const r of results.filter((x) => x.status === 'fail')) {
  console.log(`\n--- ${r.id} (new failure) ---\n${r.log ?? ''}`);
}

if (typeof args.report === 'string') {
  const label = {
    pass: '✅ pass',
    fail: '❌ **nouvel échec**',
    preexisting: '🟠 échec préexistant',
    skipped: '⏭️ ignoré',
    unavailable: '⚪ indisponible',
  };
  const md = [
    `<!-- generated by scripts/pipeline/verify.mjs — do not edit by hand -->`,
    `**verify:${mode}** sur \`${head}\`${dirty ? ' + modifications non commitées' : ''} — ${new Date().toISOString()}`,
    '',
    '| Vérification | Résultat | Détail |',
    '| --- | --- | --- |',
    ...results.map(
      (r) => `| \`${r.id}\` | ${label[r.status]} | ${(r.detail ?? '').replace(/\|/g, '\\|')} |`,
    ),
    '',
    `**Verdict** : ${verdict}`,
    '',
  ].join('\n');
  const out = resolve(root, args.report);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, md);
  // The report is a versioned artifact: write it already formatted, so the
  // repository's own format check never fails on generated output.
  run('pnpm', ['exec', 'prettier', '--write', '--log-level', 'warn', out], { timeoutMs: 60_000 });
  console.log(`report written to ${args.report}`);
}

process.exitCode = newFailures > 0 ? 1 : 0;
