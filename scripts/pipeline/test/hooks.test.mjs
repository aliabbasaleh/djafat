// The Claude Code hook scripts: input handling, failure cases, loop guard.
// Fixtures are temp git repos that symlink the real node_modules, so the
// hooks run the real prettier — nothing is written in the repository.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree, REPO } from './helpers.mjs';

const fixtures = [];
function project(files = {}) {
  const t = makeTree({ 'package.json': '{"name":"fixture","private":true}', ...files });
  symlinkSync(join(REPO, 'node_modules'), join(t.root, 'node_modules'), 'dir');
  copyFileSync(join(REPO, '.prettierrc.json'), join(t.root, '.prettierrc.json'));
  // the hooks call the pipeline checks from the project they run in
  symlinkSync(join(REPO, 'scripts'), join(t.root, 'scripts'), 'dir');
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
  ]) {
    spawnSync('git', args, { cwd: t.root });
  }
  fixtures.push(t);
  return t;
}
after(() => fixtures.forEach((f) => f.cleanup()));

function hook(name, root, payload, raw) {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/pipeline/hooks', name)], {
    input: raw ?? JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { code: r.status, err: r.stderr };
}

describe('post-edit hook', () => {
  it('ignores malformed input, missing file_path, outside paths and deleted files', () => {
    const t = project();
    assert.equal(hook('post-edit.mjs', t.root, null, 'not json').code, 0);
    assert.equal(hook('post-edit.mjs', t.root, { tool_input: {} }).code, 0);
    assert.equal(
      hook('post-edit.mjs', t.root, { tool_input: { file_path: '/etc/hosts' } }).code,
      0,
    );
    assert.equal(
      hook('post-edit.mjs', t.root, { tool_input: { file_path: join(t.root, 'gone.md') } }).code,
      0,
    );
    assert.equal(
      hook('post-edit.mjs', t.root, { tool_input: { file_path: '../../x; rm -rf /' } }).code,
      0,
    );
  });

  it('passes on a well-formatted file and reports a badly formatted one with exit 2', () => {
    const t = project({ 'ok.md': '# Titre\n\nTexte.\n', 'bad.json': '{"a":1,\n\n\n"b":   2}' });
    assert.equal(
      hook('post-edit.mjs', t.root, { tool_input: { file_path: join(t.root, 'ok.md') } }).code,
      0,
    );
    const r = hook('post-edit.mjs', t.root, { tool_input: { file_path: 'bad.json' } });
    assert.equal(r.code, 2);
    assert.match(r.err, /prettier: bad.json is not formatted/);
  });

  it('runs check-specs when a feature document is edited', () => {
    const t = project({ 'docs/features/FEAT-001-x/feature.md': '# no front matter\n' });
    const r = hook('post-edit.mjs', t.root, {
      tool_input: { file_path: 'docs/features/FEAT-001-x/feature.md' },
    });
    assert.equal(r.code, 2);
    assert.match(r.err, /check-specs:[\s\S]*missing front matter/);
  });
});

describe('stop hook', () => {
  it('never blocks twice (stop_hook_active guard)', () => {
    const t = project();
    t.write('bad.json', '{"a":1,\n\n"b":2}');
    assert.equal(hook('stop.mjs', t.root, { stop_hook_active: true }).code, 0);
  });

  it('lets a clean tree stop and blocks a failing change once with diagnostics', () => {
    const t = project({ 'ok.md': '# ok\n' });
    assert.equal(hook('stop.mjs', t.root, { stop_hook_active: false }).code, 0);
    t.write('src/a.spec.ts', "it.only('x', () => {});\n");
    const r = hook('stop.mjs', t.root, { stop_hook_active: false });
    assert.equal(r.code, 2);
    assert.match(r.err, /check-hygiene:[\s\S]*focused-test/);
  });
});
