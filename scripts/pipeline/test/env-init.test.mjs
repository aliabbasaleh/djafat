// `pnpm env:init` (scripts/env-init.mjs), audit finding DOC-03: the local `.env`
// gets real random secrets instead of the placeholders of `.env.example`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SECRETS, fillSecrets, initEnv } from '../../env-init.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');
const valueOf = (text, name) =>
  text
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`))
    .slice(name.length + 1);

test('the placeholders of .env.example become real secrets of the right shape', () => {
  const { text, result } = fillSecrets(example);
  for (const [name, encoding] of Object.entries(SECRETS)) {
    assert.equal(result[name], 'generated', name);
    const value = valueOf(text, name);
    assert.doesNotMatch(value, /REPLACE_ME|CHANGE_ME/);
    if (encoding === 'hex') assert.match(value, /^[0-9a-f]{64}$/, name);
    else assert.equal(Buffer.from(value, 'base64').length, 32, `${name} decodes to 32 bytes`);
  }
  const secrets = Object.keys(SECRETS).map((n) => valueOf(text, n));
  assert.equal(new Set(secrets).size, secrets.length, 'five different values');
});

test('nothing but those five lines changes', () => {
  const { text } = fillSecrets(example);
  const before = example.split('\n');
  const after = text.split('\n');
  assert.equal(after.length, before.length);
  const changed = before.map((l, i) => (l === after[i] ? null : l.split('=')[0])).filter(Boolean);
  assert.deepEqual(changed.sort(), Object.keys(SECRETS).sort());
});

test('a second run keeps the values, and real values are never replaced', () => {
  const first = fillSecrets(example).text;
  const second = fillSecrets(first);
  assert.equal(second.text, first);
  assert.ok(Object.values(second.result).every((r) => r === 'kept'));
});

test('a missing secret is added; Windows line endings are kept', () => {
  const crlf = 'NODE_ENV=development\r\nJWT_ACCESS_SECRET=REPLACE_ME\r\n';
  const { text, result } = fillSecrets(crlf);
  assert.equal(result.JWT_ACCESS_SECRET, 'generated');
  assert.equal(result.OTP_HASH_SECRET, 'added');
  assert.ok(text.endsWith('\r\n') && !/[^\r]\n/.test(text), 'CRLF only');
  assert.ok(text.startsWith('NODE_ENV=development\r\n'));
});

test('initEnv creates .env from .env.example, owner-only, and completes an existing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-init-'));
  try {
    writeFileSync(join(dir, '.env.example'), example);
    const first = initEnv(dir);
    assert.equal(first.created, true);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    assert.doesNotMatch(env, /JWT_ACCESS_SECRET=REPLACE_ME/);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
    const again = initEnv(dir);
    assert.equal(again.created, false);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
