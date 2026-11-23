import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { FilesystemObjectStorage } from './filesystem-object-storage';
import { PhotoStorage } from './photo-storage';
import { FilesController } from './files.controller';
import { fileStoreDir, fileUrlSecret, NotConfiguredObjectStorage } from './object-storage.module';
import { stripPhotoMetadata, sniffPhotoType } from './photo-file';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-04).
// A real temporary folder; the clock is controlled to test the 5-minute links.

const SECRET = 'f'.repeat(64);
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(startMs = Date.UTC(2026, 10, 23, 9, 0, 0)) {
  const dir = mkdtempSync(join(tmpdir(), 'djafat-files-'));
  dirs.push(dir);
  let now = startMs;
  const files = new FilesystemObjectStorage(dir, 'https://api.djafat.test/', SECRET, () => now);
  return {
    dir,
    files,
    photos: new PhotoStorage(files),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)),
  );

/** A tiny JPEG: SOI, APP0 (JFIF), APP1 (EXIF with a position), scan, EOI. */
function jpegWithGps(): Uint8Array {
  const app0 = bytes([0xff, 0xe0, 0x00, 0x10], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const exif = 'Exif\0\0GPS 12.1066,15.0436';
  const app1 = bytes([0xff, 0xe1, 0x00, exif.length + 2], exif);
  const scan = bytes([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6], [0x11, 0x22, 0x33], [0xff, 0xd9]);
  return bytes([0xff, 0xd8], [...app0], [...app1], [...scan]);
}

function pngChunk(type: string, data: string): number[] {
  const len = data.length;
  return [...bytes([0, 0, (len >> 8) & 0xff, len & 0xff], type, data, [0, 0, 0, 0])];
}

/** A tiny PNG: signature, IHDR, eXIf (position), tEXt, IEND. */
function pngWithGps(): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', '\0\0\0\x01\0\0\0\x01\x08\x02\0\0\0'),
    pngChunk('eXIf', 'GPS 12.1066,15.0436'),
    pngChunk('tEXt', 'Comment\0taken at home'),
    pngChunk('IEND', ''),
  );
}

function webpChunk(fourcc: string, data: number[]): number[] {
  const size = data.length;
  const pad = size % 2 ? [0] : [];
  return [...bytes(fourcc, [size & 0xff, (size >> 8) & 0xff, 0, 0], data, pad)];
}

/** A tiny WebP: VP8X (EXIF flag set), EXIF chunk (position), image chunk. */
function webpWithGps(): Uint8Array {
  const body = [
    ...webpChunk('VP8X', [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...webpChunk('EXIF', [...Buffer.from('GPS 12.1066,15.0436', 'latin1')]),
    ...webpChunk('VP8 ', [1, 2, 3]),
  ];
  const riff = body.length + 4;
  return bytes('RIFF', [riff & 0xff, (riff >> 8) & 0xff, 0, 0], 'WEBP', body);
}

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

function fakeReply() {
  const headers: Record<string, string> = {};
  return {
    headers,
    reply: { header: (k: string, v: string) => (headers[k] = v) } as unknown as FastifyReply,
  };
}

describe('SPEC-022-04 — photos on the server disk', () => {
  // SPEC-022-04-SC01
  it('SPEC-022-04-SC01 — a paper stays private: no address opens it without a valid signed link', async () => {
    const { files, photos } = setup();
    const { key } = await photos.store('private', jpegWithGps());
    expect(key).toMatch(/^private-[0-9a-f-]{36}\.jpg$/);

    expect(await files.resolveRead(key)).toEqual({ kind: 'forbidden' });
    expect(await files.resolveRead(key, '9999999999', 'forged')).toEqual({ kind: 'forbidden' });
    // a key that does not exist answers exactly like one that does
    const ghost = 'private-00000000-0000-4000-8000-000000000000.jpg';
    const link = new URL(await files.getSignedUrl(ghost, 300));
    expect(
      await files.resolveRead(ghost, link.searchParams.get('exp')!, link.searchParams.get('sig')!),
    ).toEqual({ kind: 'forbidden' });
    // nothing outside the folder can be named
    expect(await files.resolveRead('../etc/passwd')).toEqual({ kind: 'not_found' });

    const controller = new FilesController(files);
    await expect(
      controller.read(key, undefined, undefined, fakeReply().reply),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // SPEC-022-04-SC02
  it('SPEC-022-04-SC02 — the owner or an admin gets a 5-minute link; later or changed by one character: 403', async () => {
    const { files, photos, advance } = setup();
    const { key } = await photos.store('private', jpegWithGps());
    const link = new URL(await photos.link(key));
    expect(link.origin + link.pathname).toBe(`https://api.djafat.test/v1/files/${key}`);
    const exp = link.searchParams.get('exp')!;
    const sig = link.searchParams.get('sig')!;

    const ok = await files.resolveRead(key, exp, sig);
    expect(ok).toMatchObject({ kind: 'file', contentType: 'image/jpeg', family: 'private' });
    const { headers, reply } = fakeReply();
    const served = await new FilesController(files).read(key, exp, sig, reply);
    expect(served).toBeInstanceOf(StreamableFile);
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');

    const tampered = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(await files.resolveRead(key, exp, tampered)).toEqual({ kind: 'forbidden' });
    expect(await files.resolveRead(key, String(Number(exp) + 60), sig)).toEqual({
      kind: 'forbidden',
    });

    advance(5 * 60 * 1000 + 1000); // 5 minutes later
    expect(await files.resolveRead(key, exp, sig)).toEqual({ kind: 'forbidden' });
  });

  // SPEC-022-04-SC03
  it('SPEC-022-04-SC03 — a PDF renamed .jpg (415) and a 6 MB image (413) are refused; nothing is kept', async () => {
    const { dir, photos } = setup();
    await expect(photos.store('private', bytes('%PDF-1.4\n%fake'))).rejects.toMatchObject({
      status: 415,
      response: { code: 'UNSUPPORTED_FILE' },
    });
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    await expect(photos.store('private', big)).rejects.toMatchObject({
      status: 413,
      response: { code: 'FILE_TOO_LARGE' },
    });
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  // SPEC-022-04-SC04
  it('SPEC-022-04-SC04 — a logo is public: a stable address, served without a link', async () => {
    const { files, photos } = setup();
    const { key } = await photos.store('public', pngWithGps());
    const address = await photos.link(key);
    expect(address).toBe(`https://api.djafat.test/v1/files/${key}`);
    expect(await files.resolveRead(key)).toMatchObject({ kind: 'file', family: 'public' });
    const { headers, reply } = fakeReply();
    await new FilesController(files).read(key, undefined, undefined, reply);
    expect(headers['Cache-Control']).toContain('public');
    expect(await files.resolveRead('public-00000000-0000-4000-8000-000000000000.png')).toEqual({
      kind: 'not_found',
    });
  });

  it('strips the position and the text metadata from JPEG, PNG and WebP, keeping the image', async () => {
    for (const sample of [jpegWithGps(), pngWithGps(), webpWithGps()]) {
      const type = sniffPhotoType(sample)!;
      const clean = stripPhotoMetadata(sample, type);
      expect(text(clean)).not.toContain('GPS 12.1066');
      expect(text(clean)).not.toContain('taken at home');
      expect(sniffPhotoType(clean)).toBe(type);
    }
    const jpeg = stripPhotoMetadata(jpegWithGps(), 'jpg');
    expect(text(jpeg)).toContain('JFIF');
    expect([...jpeg.slice(-5)]).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
    const webp = stripPhotoMetadata(webpWithGps(), 'webp');
    expect(webp[20]).toBe(0x00); // VP8X: the EXIF flag is cleared
    expect(Buffer.from(webp).readUInt32LE(4)).toBe(webp.length - 8); // RIFF size fixed
    // a truncated file is refused, never stored half-cleaned
    expect(() => stripPhotoMetadata(jpegWithGps().slice(0, 9), 'jpg')).toThrow();
  });

  it('stores atomically, deletes, and refuses a key outside its shape', async () => {
    const { dir, files, photos } = setup();
    const { key } = await photos.store('private', jpegWithGps());
    expect(readFileSync(join(dir, key)).length).toBeGreaterThan(0);
    expect(readdirSync(dir).some((f) => f.startsWith('.upload-'))).toBe(false);
    await photos.remove(key);
    expect(existsSync(join(dir, key))).toBe(false);
    await expect(files.putObject('../evil.jpg', new Uint8Array(3), 'image/jpeg')).rejects.toThrow();
  });

  it('picks the folder and the secret from the configuration; no store means 404 and 503', async () => {
    expect(
      fileStoreDir({ NODE_ENV: 'production', OBJECT_STORAGE_DRIVER: 'filesystem' }),
    ).toBeNull();
    expect(
      fileStoreDir({
        NODE_ENV: 'production',
        OBJECT_STORAGE_DRIVER: 'filesystem',
        OBJECT_STORAGE_DIR: '/data/uploads',
      }),
    ).toBe('/data/uploads');
    expect(fileStoreDir({ NODE_ENV: 'development', OBJECT_STORAGE_DRIVER: 'filesystem' })).toMatch(
      /djafat-uploads$/,
    );
    expect(fileStoreDir({ NODE_ENV: 'development', OBJECT_STORAGE_DRIVER: 'none' })).toBeNull();
    expect(fileUrlSecret({ FILE_URL_SECRET: SECRET, JWT_ACCESS_SECRET: 'x' })).toBe(SECRET);
    const derived = fileUrlSecret({ JWT_ACCESS_SECRET: 'j'.repeat(64) });
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain('jjjj');

    await expect(
      new FilesController(null).read('public-x.png', undefined, undefined, fakeReply().reply),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(new NotConfiguredObjectStorage().putObject()).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORAGE_NOT_CONFIGURED' },
    });
  });
});
