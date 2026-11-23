import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ObjectStoragePort } from '@djafat/types';
import { parseFileKey, signFileKey, verifyFileSignature, type FileFamily } from './file-keys';
import { PHOTO_CONTENT_TYPES } from './photo-file';

/** What `GET /files/:key` may send (SPEC-022-04 R3, R4). */
export type FileRead =
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly contentType: string;
      readonly family: FileFamily;
    }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' };

/**
 * FEAT-022 (SPEC-022-04, FEAT-022-Q01): files on the server's disk, behind
 * `ObjectStoragePort` — in production a volume that the nightly backup copies.
 * Writes are atomic (a temporary file renamed into place), so a reader never
 * sees half a photo; private files are only served through a signed link.
 */
export class FilesystemObjectStorage implements ObjectStoragePort {
  constructor(
    private readonly dir: string,
    /** `API_PUBLIC_URL` — links point to `<base>/v1/files/<key>`. */
    private readonly publicBaseUrl: string,
    private readonly secret: string,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async putObject(key: string, body: Uint8Array, _contentType: string): Promise<{ key: string }> {
    this.keyOrThrow(key);
    await mkdir(this.dir, { recursive: true });
    const temporary = join(this.dir, `.upload-${randomUUID()}`);
    await writeFile(temporary, body, { mode: 0o600 });
    await rename(temporary, join(this.dir, key));
    return { key };
  }

  /** R3, R4: a public file's stable address; a private file's link valid `expiresInSeconds`. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      const { family } = this.keyOrThrow(key);
      const base = `${this.publicBaseUrl.replace(/\/+$/, '')}/v1/files/${key}`;
      if (family === 'public') return Promise.resolve(base);
      const expiresAt = Math.floor(this.nowMs() / 1000) + expiresInSeconds;
      return Promise.resolve(
        `${base}?exp=${expiresAt}&sig=${signFileKey(key, expiresAt, this.secret)}`,
      );
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async deleteObject(key: string): Promise<void> {
    this.keyOrThrow(key);
    await rm(join(this.dir, key), { force: true });
  }

  /**
   * R3: a private file needs a valid, unexpired signature — and a missing
   * private file answers like a bad link (403), so nothing tells whether it
   * exists. R4: a public file needs none; missing, it is 404.
   */
  async resolveRead(key: string, exp?: string, sig?: string): Promise<FileRead> {
    const parsed = parseFileKey(key);
    if (!parsed) return { kind: 'not_found' };
    const isPrivate = parsed.family === 'private';
    if (
      isPrivate &&
      !verifyFileSignature(key, exp, sig, this.secret, Math.floor(this.nowMs() / 1000))
    ) {
      return { kind: 'forbidden' };
    }
    const path = join(this.dir, key);
    const exists = await stat(path).then(
      (s) => s.isFile(),
      () => false,
    );
    if (!exists) return isPrivate ? { kind: 'forbidden' } : { kind: 'not_found' };
    return {
      kind: 'file',
      path,
      contentType: PHOTO_CONTENT_TYPES[parsed.type],
      family: parsed.family,
    };
  }

  private keyOrThrow(key: string) {
    const parsed = parseFileKey(key);
    if (!parsed) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    return parsed;
  }
}
