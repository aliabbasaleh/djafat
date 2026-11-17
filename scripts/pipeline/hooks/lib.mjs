// Shared plumbing for the Claude Code hooks (.claude/settings.json).
// Hooks never fix anything and never run a command built from text: they call
// the repository's own tools with fixed argument arrays (no shell), with a
// timeout, and report back. Exit 2 = feedback Claude must act on (stderr).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Read the hook payload from stdin (bounded wait, tolerant of bad JSON). */
export async function readPayload(timeoutMs = 5000) {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const done = new Promise((res) => {
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', res);
    process.stdin.on('error', res);
  });
  const timer = new Promise((res) => setTimeout(res, timeoutMs));
  await Promise.race([done, timer]);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

export function projectRoot(payload) {
  return process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
}

/** Prefer the local binary (fast, works in fixtures), fall back to pnpm exec. */
export function tool(root, name) {
  const local = join(root, 'node_modules', '.bin', name);
  return existsSync(local) ? [local, []] : ['pnpm', ['exec', name]];
}

export function runTool(cmd, args, { cwd, timeoutMs = 60_000 } = {}) {
  // Windows: neither the bare `pnpm` on PATH (a `.CMD` shim) nor pnpm's own
  // `node_modules/.bin/<tool>` (a shebang script, no native .exe/.CMD) is
  // directly spawnable — spawnSync needs a shell to resolve either, which
  // Node's own PATHEXT search does not provide. Without it, spawnSync fails
  // ENOENT and this reports a silent, output-less non-zero exit, which looks
  // exactly like a real failure. `cmd` and each `args` entry must be quoted
  // by hand for that shell: unquoted, cmd.exe splits an absolute path with
  // spaces (e.g. `C:\Program Files\nodejs\node.exe`) at the first space, and
  // treats `(`/`)`/`&`/`|`/`^`/`<`/`>` as its own syntax anywhere outside
  // quotes — e.g. a route group directory like `app/(app)/home.tsx`
  // (Next.js/Expo Router's own naming convention).
  const useShell = process.platform === 'win32';
  const shellQuote = (s) => (/[\s()&|^<>]/.test(s) ? `"${s}"` : s);
  const quotedArgs = useShell ? args.map(shellQuote) : args;
  const r = spawnSync(useShell ? shellQuote(cmd) : cmd, quotedArgs, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
    shell: useShell,
  });
  return {
    ok: r.status === 0,
    timedOut: r.error?.code === 'ETIMEDOUT',
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
  };
}

export function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return '';
  }
}

export function trim(text, max = 60) {
  const lines = text.split('\n');
  return lines.length > max
    ? [...lines.slice(0, max), `… (${lines.length - max} more lines)`].join('\n')
    : text;
}
