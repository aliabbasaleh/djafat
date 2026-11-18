#!/usr/bin/env node
// pnpm env:init — create or complete the local `.env` (audit finding DOC-03).
//
// `.env.example` ships placeholders for the five secrets the API needs. Copied
// as is, the API starts in development (it only warns, SEC-01), but every
// delivery then fails at pickup (the delivery-code key does not decode to 32
// bytes) and MFA enrolment fails the same way. This script copies
// `.env.example` to `.env` when `.env` is missing, then gives each of those
// secrets a fresh random value wherever it is empty or still a placeholder.
// Real values already there are kept, nothing else in the file changes, and
// no value is ever printed. Plain Node, so it behaves the same on Windows.
//
//   pnpm env:init                 the repository's own .env
//   node scripts/env-init.mjs --root <dir>
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The secrets `.env.example` leaves as placeholders, and how each is encoded. */
export const SECRETS = {
  JWT_ACCESS_SECRET: 'hex',
  REFRESH_TOKEN_HASH_SECRET: 'hex',
  OTP_HASH_SECRET: 'hex',
  MFA_ENCRYPTION_KEY: 'base64',
  DELIVERY_CODE_ENCRYPTION_KEY: 'base64',
};
const PLACEHOLDER = /REPLACE_ME|CHANGE_ME/i;

/** 32 random bytes: 64 hex characters for an HMAC secret, a 32-byte key in base64 for AES. */
export const freshValue = (encoding, random = randomBytes) => random(32).toString(encoding);

/**
 * Fills the secrets in the text of a `.env` file. Returns the new text and,
 * per secret, what happened: `generated` (was empty or a placeholder), `added`
 * (the line was missing) or `kept` (a real value was already there).
 */
export function fillSecrets(text, random = randomBytes) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();
  const result = {};
  for (const [name, encoding] of Object.entries(SECRETS)) {
    const i = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (i === -1) {
      lines.push(`${name}=${freshValue(encoding, random)}`);
      result[name] = 'added';
      continue;
    }
    const value = lines[i]
      .slice(name.length + 1)
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
    if (value === '' || PLACEHOLDER.test(value)) {
      lines[i] = `${name}=${freshValue(encoding, random)}`;
      result[name] = 'generated';
    } else {
      result[name] = 'kept';
    }
  }
  return { text: lines.join(eol) + (trailingNewline ? eol : ''), result };
}

/** Creates `<root>/.env` from `.env.example` if needed, then fills its secrets. */
export function initEnv(root) {
  const envPath = resolve(root, '.env');
  const created = !existsSync(envPath);
  if (created) copyFileSync(resolve(root, '.env.example'), envPath);
  const { text, result } = fillSecrets(readFileSync(envPath, 'utf8'));
  writeFileSync(envPath, text);
  if (process.platform !== 'win32') chmodSync(envPath, 0o600); // secrets: owner only
  return { created, result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root =
    i > -1 ? resolve(process.argv[i + 1]) : resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { created, result } = initEnv(root);
  console.log(
    created ? '.env created from .env.example' : '.env already there: completed in place',
  );
  for (const [name, what] of Object.entries(result)) console.log(`  ${name}: ${what}`);
  console.log(
    'Values are random and never printed; .env stays on this computer (it is in .gitignore).',
  );
}
