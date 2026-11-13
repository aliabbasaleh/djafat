#!/usr/bin/env node
// Claude Code PostToolUse hook (matcher Edit|Write|MultiEdit) — scoped FAST
// checks on the single edited file, never the full suite:
//   * prettier --check                     (all formattable files)
//   * eslint --max-warnings=0 <file>       (code inside an apps/* or packages/* package,
//                                            from that package so its own flat config applies)
//   * check-specs                           (feature/spec docs and test files)
// Exit 0 = nothing to report. Exit 2 = diagnostics on stderr, fed back to Claude.
// Read-only: it never rewrites the file (no recursion with the edit tools).
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { projectRoot, readPayload, runTool, tool, trim } from './lib.mjs';

const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml)$/;
const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SPEC_RELEVANT = /^docs\/features\/|(\.spec|\.test|\.int\.spec)\.[cm]?[jt]sx?$/;
const IGNORED = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.expo|coverage|\.git)\//;

const payload = await readPayload();
const root = resolve(projectRoot(payload));
const raw = payload?.tool_input?.file_path;
if (typeof raw !== 'string' || raw.length === 0) process.exit(0);

const file = resolve(isAbsolute(raw) ? raw : join(root, raw));
const rel = relative(root, file).split(sep).join('/');
// Outside the project, ignored folders, deleted files: nothing to check.
if (rel.startsWith('..') || isAbsolute(rel) || IGNORED.test(rel) || !existsSync(file))
  process.exit(0);

const problems = [];

if (FORMATTABLE.test(rel)) {
  const [cmd, pre] = tool(root, 'prettier');
  const r = runTool(cmd, [...pre, '--check', '--ignore-unknown', rel], {
    cwd: root,
    timeoutMs: 30_000,
  });
  if (!r.ok) {
    problems.push(
      r.timedOut
        ? `prettier timed out on ${rel}`
        : `prettier: ${rel} is not formatted. Fix with: pnpm exec prettier --write ${rel}`,
    );
  }
}

if (LINTABLE.test(rel) && /^(apps|packages)\/[^/]+\//.test(rel)) {
  const pkgDir = rel.split('/').slice(0, 2).join('/');
  if (existsSync(join(root, pkgDir, 'eslint.config.mjs'))) {
    const fileInPkg = relative(join(root, pkgDir), file);
    const [cmd, pre] = tool(join(root, pkgDir), 'eslint');
    const r = runTool(cmd, [...pre, '--max-warnings=0', '--no-warn-ignored', fileInPkg], {
      cwd: join(root, pkgDir),
      timeoutMs: 90_000,
    });
    if (!r.ok)
      problems.push(
        r.timedOut
          ? `eslint timed out on ${rel} (run: pnpm --filter ./${pkgDir} lint)`
          : `eslint (${pkgDir}):\n${trim(r.output)}`,
      );
  }
}

if (SPEC_RELEVANT.test(rel) && existsSync(join(root, 'scripts/pipeline/check-specs.mjs'))) {
  const r = runTool(
    process.execPath,
    [join(root, 'scripts/pipeline/check-specs.mjs'), '--root', root],
    {
      cwd: root,
      timeoutMs: 30_000,
    },
  );
  if (!r.ok) problems.push(`check-specs:\n${trim(r.output)}`);
}

if (problems.length > 0) {
  process.stderr.write(
    `[pipeline post-edit] ${rel}\n${problems.join('\n\n')}\n\nFix these before continuing (they are the same checks CI runs). Full scope: pnpm verify:fast\n`,
  );
  process.exit(2);
}
process.exit(0);
