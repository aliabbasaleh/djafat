import type { Readable } from 'node:stream';
import { UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  photoTooLarge,
  unsupportedPhoto,
} from './photo-file';

/**
 * FEAT-022 (SPEC-022-04 R2, FEAT-022-Q08): a photo is sent as the body of its
 * request — `Content-Type: image/jpeg`, `image/png` or `image/webp` (or
 * `application/octet-stream`), one photo per request, 5 MB at most, on the
 * upload routes only — every other route keeps its 1 MB JSON limit and answers
 * these types 415 without reading them. What the bytes really are is checked
 * when the photo is stored (`PhotoStorage.store`), never trusted from the type.
 *
 * Not `multipart/form-data` (`@fastify/multipart`): its parser's type
 * declarations replace every `stream.Readable#on` overload in the API's
 * TypeScript program (part 2 of FEAT-022), and one photo per request needs no
 * form encoding.
 */
export const PHOTO_UPLOAD_CONTENT_TYPES: readonly string[] = [
  ...Object.values(PHOTO_CONTENT_TYPES),
  'application/octet-stream',
];

/**
 * A photo a little too big is read to its end and answered 413, so the phone
 * shows « La photo dépasse 5 Mo » instead of a cut connection (a reply sent
 * while the client still writes closes the socket under it). Past this much,
 * the connection is cut.
 */
const DRAIN_LIMIT_BYTES = 4 * MAX_PHOTO_BYTES;

/**
 * The routes that take a photo as their body: `…/application/files/:kind`
 * (couriers' and restaurants' papers) and `/restaurants/me/photos/:kind` (a
 * restaurant's logo and cover, FEAT-022 part 3).
 */
export function isPhotoUploadRoute(url: string | undefined): boolean {
  return (
    url !== undefined &&
    (/\/application\/files\/:kind$/.test(url) || /\/restaurants\/me\/photos\/:kind$/.test(url))
  );
}

type ParserDone = (err: Error | null, body?: Buffer) => void;

/** Throws when the access token is forged or expired (`TokenService.verifyAccessToken`: no I/O). */
export type AccessTokenCheck = (token: string) => void;

/**
 * Reads one photo body. Only an upload route reads anything, and only with a
 * valid access token (signature and expiry checked here): every other route
 * answers 415 as before, and an upload without a valid token is refused
 * before its first byte — the guard would refuse it anyway, but only after
 * 5 MB (review of FEAT-022 parts 1-2, finding 2 and N1). A token of a session
 * revoked meanwhile still reaches the guard, which refuses it.
 */
export function readPhotoBody(
  req: Pick<FastifyRequest, 'headers' | 'routeOptions'>,
  payload: Readable,
  done: ParserDone,
  checkToken: AccessTokenCheck,
): void {
  let settled = false;
  const finish = (err: Error | null, body?: Buffer) => {
    if (settled) return;
    settled = true;
    done(err, body);
  };
  if (!isPhotoUploadRoute(req.routeOptions.url)) {
    finish(
      new UnsupportedMediaTypeException({
        code: 'VALIDATION_ERROR',
        message: `Unsupported Media Type: ${String(req.headers['content-type'] ?? '')}`,
      }),
    );
    return;
  }
  const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
  if (!token) {
    finish(
      new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Missing bearer token.' }),
    );
    return;
  }
  try {
    checkToken(token);
  } catch {
    finish(
      new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' }),
    );
    return;
  }
  if (Number(req.headers['content-length'] ?? 0) > DRAIN_LIMIT_BYTES) {
    finish(photoTooLarge());
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  payload.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > DRAIN_LIMIT_BYTES) {
      finish(photoTooLarge());
      payload.destroy();
    } else if (size <= MAX_PHOTO_BYTES) {
      chunks.push(chunk);
    }
  });
  payload.on('end', () => {
    if (size > MAX_PHOTO_BYTES) finish(photoTooLarge());
    else finish(null, Buffer.concat(chunks));
  });
  payload.on('error', (err) => finish(err));
}

/** Registered by `configureApp`, so the real process and the integration tests read uploads the same way. */
export function registerPhotoUploads(
  app: NestFastifyApplication,
  checkToken: AccessTokenCheck,
): void {
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser([...PHOTO_UPLOAD_CONTENT_TYPES], (req, payload, done) =>
    readPhotoBody(req, payload, done, checkToken),
  );
}

/** The uploaded photo's bytes; anything else (no body, JSON…) is 415 `UNSUPPORTED_FILE`. */
export function uploadedPhoto(req: FastifyRequest): Uint8Array {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw unsupportedPhoto();
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}
