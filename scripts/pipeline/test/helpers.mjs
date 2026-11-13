// Temporary, isolated fixture trees for the pipeline tooling tests. Nothing is
// ever written inside the real repository: every fixture lives in os.tmpdir()
// and is removed after the test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** @param {Record<string, string>} files relative path -> content */
export function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'djafat-pipeline-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return {
    root,
    write(rel, content) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Run one of the pipeline CLIs; returns { code, out }. */
export function runCli(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/pipeline', script), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    ...opts,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

export function messages(report) {
  return report.errors.map((e) => e.message).join('\n');
}
