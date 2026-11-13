#!/usr/bin/env node
// Claude Code Stop hook — a cheap completion gate on what changed vs HEAD:
// prettier on changed files + the graph-wide pipeline checks (specs, hygiene,
// architecture). lint/typecheck/tests are NOT re-run here (too slow for every
// stop); CLAUDE.md requires `pnpm verify:fast` before claiming completion.
//
// Exit 2 blocks the stop once, with diagnostics. `stop_hook_active` (set by
// Claude Code when it is already continuing because of a Stop hook) makes it
// exit 0, so the hook can never loop.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git, projectRoot, readPayload, runTool, tool, trim } from './lib.mjs';

const payload = await readPayload();
if (payload?.stop_hook_active === true) process.exit(0);
const root = resolve(projectRoot(payload));
if (!existsSync(join(root, 'scripts/pipeline/check-specs.mjs'))) process.exit(0);

const changed = [
  ...new Set([
    ...git(root, ['diff', '--name-only', 'HEAD']).split('\n'),
    ...git(root, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ]),
].filter((f) => f && existsSync(join(root, f)));
if (changed.length === 0) process.exit(0);

const problems = [];
const formattable = changed.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml)$/.test(f));
if (formattable.length > 0) {
  const [cmd, pre] = tool(root, 'prettier');
  const r = runTool(cmd, [...pre, '--check', '--ignore-unknown', ...formattable], {
    cwd: root,
    timeoutMs: 60_000,
  });
  if (!r.ok) problems.push(`prettier:\n${trim(r.output, 30)}`);
}
for (const check of ['check-specs', 'check-hygiene', 'check-arch']) {
  const r = runTool(
    process.execPath,
    [join(root, 'scripts/pipeline', `${check}.mjs`), '--root', root],
    {
      cwd: root,
      timeoutMs: 60_000,
    },
  );
  if (!r.ok) problems.push(`${check}:\n${trim(r.output, 30)}`);
}

if (problems.length > 0) {
  process.stderr.write(
    `[pipeline stop] ${changed.length} changed file(s) fail the completion gate:\n\n${problems.join('\n\n')}\n\nFix them, then run pnpm verify:fast and report its real result (never "all green" with pre-existing or unavailable checks).\n`,
  );
  process.exit(2);
}
process.exit(0);
