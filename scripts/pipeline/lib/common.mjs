// Shared helpers for the pipeline tooling (docs/pipeline/README.md).
// Zero dependencies on purpose: these scripts must run from a clean checkout
// right after `pnpm install`, before any package is built.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.expo',
  'coverage',
  '.git',
]);

/** Recursively list files under `dir`, skipping build/vendor folders. */
export function walk(dir, predicate = () => true) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (predicate(full)) out.push(full);
    }
  }
  return out.sort();
}

/**
 * Files tracked or newly added (untracked, not ignored) in the git work tree.
 * Falls back to a filesystem walk outside a git repository (fixtures).
 */
export function listSourceFiles(root) {
  try {
    const raw = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return raw
      .split('\0')
      .filter(Boolean)
      .filter((f) => !f.split('/').some((part) => SKIP_DIRS.has(part)))
      .filter((f) => existsSync(join(root, f)))
      .sort();
  } catch {
    return walk(root).map((f) => toPosix(relative(root, f)));
  }
}

export function toPosix(p) {
  return p.split(sep).join('/');
}

export function read(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Minimal front-matter parser: `key: value` and inline lists `key: [a, b]`.
 * Deliberately not YAML — the templates only use these two shapes, and a
 * parser this small cannot silently accept something the templates forbid.
 */
export function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: null, body: text, bodyOffsetLines: 0 };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) {
      data.__invalid = [...(data.__invalid ?? []), line];
      continue;
    }
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      data[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return {
    data,
    body: text.slice(match[0].length),
    bodyOffsetLines: match[0].split('\n').length - 1,
  };
}

/** Split a markdown body into `## ` sections: { heading, content, line }. */
export function sections(body, offset = 0) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let current = null;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence && /^## (.+?)\s*$/.exec(line);
    if (h) {
      current = { heading: h[1], content: [], line: i + 1 + offset };
      out.push(current);
    } else if (current) {
      current.content.push(line);
    }
  });
  return out.map((s) => ({ ...s, content: s.content.join('\n').trim() }));
}

/** Normalise a heading for comparison (case, accents, punctuation). */
export function normHeading(h) {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class Report {
  constructor(tool) {
    this.tool = tool;
    this.errors = [];
    this.warnings = [];
  }
  error(file, message, line) {
    this.errors.push({ file, line, message });
  }
  warn(file, message, line) {
    this.warnings.push({ file, line, message });
  }
  print({ json = false } = {}) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ tool: this.tool, errors: this.errors, warnings: this.warnings }, null, 2)}\n`,
      );
      return;
    }
    const fmt = (kind, d) => `${kind} ${d.file}${d.line ? `:${d.line}` : ''} — ${d.message}`;
    for (const w of this.warnings) console.warn(fmt('warning', w));
    for (const e of this.errors) console.error(fmt('error  ', e));
    const summary = `${this.tool}: ${this.errors.length} error(s), ${this.warnings.length} warning(s)`;
    if (this.errors.length > 0) console.error(summary);
    else console.log(summary);
  }
  get exitCode() {
    return this.errors.length > 0 ? 1 : 0;
  }
}

/** `--root <dir>` / `--json` CLI parsing shared by every check. */
export function parseArgs(argv, defaults) {
  const args = { ...defaults, json: false, rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else args[key] = argv[++i];
    } else args.rest.push(a);
  }
  return args;
}

/**
 * True when the module is the process entry point — compared on REAL paths,
 * so a CLI invoked through a symlink still runs (a naive URL comparison makes
 * it silently do nothing and exit 0).
 */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
