// check-audit: a NEW advisory fails, baselined ones pass, a fixed one warns,
// an unreadable audit is "unavailable" (exit 2), never a pass.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { advisoryKeys, compareAudit } from '../check-audit.mjs';
import { makeTree, runCli } from './helpers.mjs';

const adv = (id, module, severity = 'high') => ({
  github_advisory_id: id,
  module_name: module,
  severity,
  title: `${module} issue`,
  patched_versions: '>=9.9.9',
  findings: [{ version: '1.0.0', paths: [`apps/api>${module}`] }],
});
const audit = (...list) => ({ advisories: Object.fromEntries(list.map((a, i) => [String(i), a])) });

const fixtures = [];
after(() => fixtures.forEach((f) => f.cleanup()));

describe('check-audit', () => {
  it('flags only advisories absent from the baseline, and lists fixed ones', () => {
    const current = advisoryKeys(audit(adv('GHSA-old', 'next'), adv('GHSA-new', 'nodemailer')));
    const { added, fixed } = compareAudit(current, ['GHSA-old|next', 'GHSA-gone|lodash']);
    assert.deepEqual(
      added.map((a) => a.key),
      ['GHSA-new|nodemailer'],
    );
    assert.deepEqual(fixed, ['GHSA-gone|lodash']);
  });

  it('CLI: exit 1 on a new advisory, 0 when everything is baselined, 2 when the audit is unreadable', () => {
    const t = makeTree({});
    fixtures.push(t);
    writeFileSync(join(t.root, 'baseline.json'), JSON.stringify({ advisories: ['GHSA-old|next'] }));
    writeFileSync(join(t.root, 'clean.json'), JSON.stringify(audit(adv('GHSA-old', 'next'))));
    writeFileSync(
      join(t.root, 'dirty.json'),
      JSON.stringify(audit(adv('GHSA-old', 'next'), adv('GHSA-new', 'nodemailer'))),
    );
    writeFileSync(join(t.root, 'broken.json'), '{"error":"registry down"}');
    const run = (input) =>
      runCli('check-audit.mjs', ['--root', t.root, '--baseline', 'baseline.json', '--input', input])
        .code;
    assert.equal(run('clean.json'), 0);
    assert.equal(run('dirty.json'), 1);
    assert.equal(run('broken.json'), 2);
  });
});
