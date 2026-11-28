#!/usr/bin/env node
// ci-scope: which GitHub Actions jobs a run needs, to spend fewer minutes
// (the repository is private: its monthly Actions minutes ran out on
// 2026-11-23). Used by the `scope` job of .github/workflows/ci.yml and
// windows.yml.
//
//   push to main, manual run      → every check
//   draft pull request            → no heavy job (« Ready for review » runs them)
//   pull request, docs only       → format and spec checks only
//   any other pull request        → every check
//
// "Docs only" is judged on the WHOLE pull request (its base → the merge
// GitHub tests), never on the last push alone: code is always tested before
// it is merged, even when a later push only touches documentation.
//
// Inputs (environment): EVENT (github.event_name), DRAFT ("true"/"false"),
// BASE_SHA (the pull request's base commit). Writes `heavy=` and `docs=` to
// $GITHUB_OUTPUT when set, and prints the decision.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isMainModule } from './lib/common.mjs';

/** Documentation: nothing in it is built, run or tested. */
const DOC_PATHS = [/^docs\//, /^docs_2\//, /\.md$/i];

/**
 * A root package.json diff that only changes `version` — every push is a
 * version (CLAUDE.md), so a docs-only pull request still bumps it.
 */
export function onlyVersionBump(diffText) {
  const changed = diffText
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)( |$)/.test(line));
  return (
    changed.length > 0 && changed.every((line) => /^[+-]\s*"version":\s*"[^"]*",?\s*$/.test(line))
  );
}

/** True when every changed file is documentation (or the root version bump). */
export function isDocsOnly(files, rootPackageDiff = '') {
  if (files.length === 0) return false; // nothing to judge: run everything
  return files.every(
    (file) =>
      DOC_PATHS.some((pattern) => pattern.test(file)) ||
      (file === 'package.json' && onlyVersionBump(rootPackageDiff)),
  );
}

/** The decision itself, without git: easy to test. */
export function ciScope({ event, draft, files, rootPackageDiff }) {
  if (event !== 'pull_request') {
    return { heavy: true, docs: false, reason: `${event}: every check` };
  }
  if (draft) {
    return {
      heavy: false,
      docs: false,
      reason: 'draft pull request: mark it « Ready for review » to run the checks',
    };
  }
  if (isDocsOnly(files, rootPackageDiff)) {
    return { heavy: false, docs: true, reason: 'documentation only: format and spec checks' };
  }
  return { heavy: true, docs: false, reason: 'code changed: every check' };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (isMainModule(import.meta.url)) {
  const event = process.env.EVENT ?? '';
  const draft = process.env.DRAFT === 'true';
  let files = [];
  let rootPackageDiff = '';
  if (event === 'pull_request' && !draft) {
    const base = process.env.BASE_SHA;
    if (!base) {
      console.error('ci-scope: BASE_SHA is required for a pull request');
      process.exit(1);
    }
    // HEAD is the merge commit GitHub tests: base → HEAD is the whole pull request.
    files = git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
    rootPackageDiff = git(['diff', base, 'HEAD', '--', 'package.json']);
  }
  const scope = ciScope({ event, draft, files, rootPackageDiff });
  console.log(`ci-scope: ${scope.reason} (heavy=${scope.heavy}, docs=${scope.docs})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `heavy=${scope.heavy}\ndocs=${scope.docs}\n`);
  }
}
