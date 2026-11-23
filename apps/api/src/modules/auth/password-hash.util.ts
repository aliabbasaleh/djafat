import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password storage for customer accounts (FEAT-020, SPEC-020-02 R7,
 * FEAT-020-Q14): Node's built-in scrypt, no native dependency, parameters from
 * the OWASP list for scrypt (N = 2^15, r = 8, p = 3, about 32 MiB). Encoded
 * `scrypt$N$r$p$<salt>$<key>` (base64url) so verification reads the
 * parameters back. Pure: no I/O, the caller owns persistence.
 */

const ALGORITHM = 'scrypt';
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** scrypt needs 128 * N * r bytes; Node's default ceiling (32 MiB) is exactly that, so lift it. */
const maxmemFor = (cost: number, blockSize: number): number => 2 * 128 * cost * blockSize;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxmemFor(COST, BLOCK_SIZE),
  });
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** Parameters a stored hash may carry; anything else is refused before any work. */
function acceptable(cost: number, blockSize: number, parallelism: number): boolean {
  const powerOfTwo = Number.isInteger(cost) && cost > 1 && (cost & (cost - 1)) === 0;
  return (
    powerOfTwo &&
    cost >= 2 ** 14 &&
    cost <= 2 ** 17 &&
    Number.isInteger(blockSize) &&
    blockSize >= 1 &&
    blockSize <= 16 &&
    Number.isInteger(parallelism) &&
    parallelism >= 1 &&
    parallelism <= 8
  );
}

/** True only for the right password; a malformed hash is a plain `false`, never an exception. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;
  const [, costRaw, blockRaw, parallelRaw, saltRaw = '', keyRaw = ''] = parts;
  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelism = Number(parallelRaw);
  if (!acceptable(cost, blockSize, parallelism)) return false;
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(keyRaw, 'base64url');
  if (salt.length < SALT_BYTES || expected.length < KEY_BYTES) return false;
  try {
    const actual = await derive(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: maxmemFor(cost, blockSize),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
