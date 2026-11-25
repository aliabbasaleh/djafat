import { Readable } from 'node:stream';
import type { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { isPhotoUploadRoute, readPhotoBody } from './photo-upload';

// FEAT-022 (SPEC-022-04 R2, FEAT-022-Q08) — review of parts 1-2, finding 2.

const UPLOAD = '/v1/couriers/me/application/files/:kind';
const MB = 1024 * 1024;

function request(url: string, headers: Record<string, string> = {}) {
  return {
    routeOptions: { url },
    headers: { authorization: 'Bearer token', 'content-type': 'image/jpeg', ...headers },
  } as unknown as Parameters<typeof readPhotoBody>[0];
}

/** A body that records whether anyone started reading it. */
function body(bytes: number) {
  const chunk = Buffer.alloc(64 * 1024, 0xff);
  let left = bytes;
  const stream = new Readable({
    read() {
      if (left <= 0) {
        this.push(null);
        return;
      }
      const n = Math.min(left, chunk.length);
      left -= n;
      this.push(chunk.subarray(0, n));
    },
  });
  return stream;
}

/** A token check like `TokenService.verifyAccessToken`: only « token » is valid. */
const checkToken = (token: string) => {
  if (token !== 'token') throw new Error('invalid signature');
};

function run(req: Parameters<typeof readPhotoBody>[0], payload: Readable) {
  return new Promise<{ status: number | null; code: unknown; length: number | null }>((resolve) =>
    readPhotoBody(
      req,
      payload,
      (err, out) =>
        resolve({
          status: err ? (err as HttpException).getStatus() : null,
          code: err ? ((err as HttpException).getResponse() as { code?: unknown }).code : null,
          length: out ? out.length : null,
        }),
      checkToken,
    ),
  );
}

describe('the photo body parser', () => {
  it('knows the upload routes', () => {
    expect(isPhotoUploadRoute(UPLOAD)).toBe(true);
    expect(isPhotoUploadRoute('/v1/restaurants/me/application/files/:kind')).toBe(true);
    // FEAT-022 part 3 (SPEC-022-05 R1, step 3): the logo and the cover.
    expect(isPhotoUploadRoute('/v1/restaurants/me/photos/:kind')).toBe(true);
    expect(isPhotoUploadRoute('/v1/restaurants/me/photos')).toBe(false);
    expect(isPhotoUploadRoute('/v1/auth/login')).toBe(false);
    expect(isPhotoUploadRoute(undefined)).toBe(false);
  });

  it('another route answers 415 as before, without reading a byte', async () => {
    const payload = body(5 * MB);
    expect(await run(request('/v1/auth/login'), payload)).toMatchObject({ status: 415 });
    expect(payload.readableFlowing).toBeNull(); // never started
  });

  it('an upload without a session is refused before its first byte (401)', async () => {
    const payload = body(5 * MB);
    const res = await run(request(UPLOAD, { authorization: '' }), payload);
    expect(res).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(payload.readableFlowing).toBeNull();
  });

  it('a forged or expired token is refused before the first byte too (401)', async () => {
    const payload = body(5 * MB);
    const res = await run(request(UPLOAD, { authorization: 'Bearer forged' }), payload);
    expect(res).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(payload.readableFlowing).toBeNull();
  });

  it('SPEC-022-04-SC03 — 5 MB is kept; a little more is read to its end, then 413 FILE_TOO_LARGE', async () => {
    expect(await run(request(UPLOAD), body(5 * MB))).toEqual({
      status: null,
      code: null,
      length: 5 * MB,
    });
    expect(await run(request(UPLOAD), body(6 * MB))).toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  });

  it('far too big by its declared length: 413 at once, nothing read', async () => {
    const payload = body(25 * MB);
    const res = await run(request(UPLOAD, { 'content-length': String(25 * MB) }), payload);
    expect(res).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(payload.readableFlowing).toBeNull();
  });
});
