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
 * `application/octet-stream`), one photo per request, 5 MB at most. The rest
 * of the API keeps its 1 MB JSON limit. What the bytes really are is checked
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

/** Registered by `configureApp`, so the real process and the integration tests read uploads the same way. */
export function registerPhotoUploads(app: NestFastifyApplication): void {
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser([...PHOTO_UPLOAD_CONTENT_TYPES], (req, payload, done) => {
    let settled = false;
    const finish = (err: Error | null, body?: Buffer) => {
      if (settled) return;
      settled = true;
      done(err, body);
    };
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
  });
}

/** The uploaded photo's bytes; anything else (no body, JSON…) is 415 `UNSUPPORTED_FILE`. */
export function uploadedPhoto(req: FastifyRequest): Uint8Array {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw unsupportedPhoto();
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}
