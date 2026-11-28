// ci-scope: GitHub Actions minutes are spent only where a check can find
// something — never skipping a check that a code change needs.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciScope, isDocsOnly, onlyVersionBump } from '../ci-scope.mjs';
import { makeTree, runCli } from './helpers.mjs';

const VERSION_BUMP = [
  'diff --git a/package.json b/package.json',
  '--- a/package.json',
  '+++ b/package.json',
  '@@ -1,6 +1,6 @@',
  ' {',
  '   "name": "djafat",',
  '-  "version": "0.24.4",',
  '+  "version": "0.24.5",',
  '   "private": true,',
].join('\n');
const SCRIPT_CHANGE = `${VERSION_BUMP}\n-    "test": "turbo run test",\n+    "test": "turbo run test --filter=web",`;

const fixtures = [];
after(() => fixtures.forEach((f) => f.cleanup()));

describe('ci-scope', () => {
  it('runs every check on a push to main and on a manual run', () => {
    for (const event of ['push', 'workflow_dispatch', 'schedule']) {
      const scope = ciScope({ event, draft: false, files: ['docs/ROADMAP.md'] });
      assert.equal(scope.heavy, true, event);
    }
  });

  it('runs nothing heavy on a draft pull request, even with code', () => {
    const scope = ciScope({
      event: 'pull_request',
      draft: true,
      files: ['apps/api/src/main.ts'],
    });
    assert.deepEqual([scope.heavy, scope.docs], [false, false]);
    assert.match(scope.reason, /Ready for review/);
  });

  it('runs only the docs checks when the whole pull request is documentation', () => {
    const files = [
      'docs/ROADMAP.md',
      'docs_2/history/SYNC_LOG.md',
      'docs/features/FEAT-021-equipe-connexion-email/assets/exec-SPEC-021-04-SC06-390.png',
      'README.md',
      'apps/web/README.md',
      'package.json',
    ];
    const scope = ciScope({
      event: 'pull_request',
      draft: false,
      files,
      rootPackageDiff: VERSION_BUMP,
    });
    assert.deepEqual([scope.heavy, scope.docs], [false, true]);
  });

  it('runs every check as soon as one file is not documentation', () => {
    for (const code of ['apps/api/src/main.ts', '.github/workflows/ci.yml', 'pnpm-lock.yaml']) {
      const scope = ciScope({
        event: 'pull_request',
        draft: false,
        files: ['docs/ROADMAP.md', code],
      });
      assert.deepEqual([scope.heavy, scope.docs], [true, false], code);
    }
  });

  it('treats a root package.json change other than the version as code', () => {
    assert.equal(onlyVersionBump(VERSION_BUMP), true);
    assert.equal(onlyVersionBump(SCRIPT_CHANGE), false);
    assert.equal(onlyVersionBump(''), false);
    assert.equal(isDocsOnly(['package.json'], SCRIPT_CHANGE), false);
    assert.equal(isDocsOnly(['apps/web/package.json'], VERSION_BUMP), false);
  });

  it('runs everything when there is nothing to judge', () => {
    assert.equal(isDocsOnly([]), false);
    assert.equal(ciScope({ event: 'pull_request', draft: false, files: [] }).heavy, true);
  });

  it('judges the whole pull request from git, not the last push', () => {
    const tree = makeTree({
      'package.json': '{\n  "version": "0.24.4"\n}\n',
      'apps/api/main.ts': 'a\n',
    });
    fixtures.push(tree);
    const git = (...args) => execFileSync('git', args, { cwd: tree.root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('-c', 'user.email=ci@test', '-c', 'user.name=ci', 'add', '-A');
    git('-c', 'user.email=ci@test', '-c', 'user.name=ci', 'commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    const commit = (file, content, message) => {
      tree.write(file, content);
      git('-c', 'user.email=ci@test', '-c', 'user.name=ci', 'add', '-A');
      git('-c', 'user.email=ci@test', '-c', 'user.name=ci', 'commit', '-qm', message);
    };
    const run = () => {
      const output = join(tree.root, 'gh-output.txt');
      tree.write('gh-output.txt', '');
      const r = runCli('ci-scope.mjs', [], {
        cwd: tree.root,
        env: {
          ...process.env,
          EVENT: 'pull_request',
          DRAFT: 'false',
          BASE_SHA: base,
          GITHUB_OUTPUT: output,
        },
      });
      assert.equal(r.code, 0, r.out);
      return readFileSync(output, 'utf8');
    };

    commit('docs/ROADMAP.md', 'journal\n', 'docs');
    commit('package.json', '{\n  "version": "0.24.5"\n}\n', 'version');
    assert.equal(run(), 'heavy=false\ndocs=true\n');

    // code, then a docs-only push on top: the pull request still has code
    commit('apps/api/main.ts', 'b\n', 'code');
    commit('docs/ROADMAP.md', 'journal 2\n', 'docs again');
    assert.equal(run(), 'heavy=true\ndocs=false\n');
  });
});
