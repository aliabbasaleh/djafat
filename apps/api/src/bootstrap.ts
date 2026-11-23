import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { registerPhotoUploads } from './infra/storage/photo-upload';

/**
 * The request-handling wiring shared by the real process (`main.ts`) and the
 * integration test harness (`test/walking-skeleton.int.spec.ts`). Kept as one
 * function so the two can never drift apart — e.g. the test previously would
 * have silently NOT exercised the raw-body webhook parser or URI versioning
 * if each place reimplemented this by hand (docs/18 §14).
 *
 * Raw body preservation (docs/08 §8.6 — webhook signature verification MUST
 * hash/HMAC the bytes as sent, not a re-serialised object) is handled by
 * `NestFactory.create`'s `rawBody: true` option (see `main.ts`), not here:
 * registering a second `application/json` content-type parser directly on
 * the Fastify instance collides with Nest's own default one at `app.init()`
 * (`FST_ERR_CTP_ALREADY_PRESENT`) — `rawBody: true` is the one mechanism
 * Nest's Fastify adapter supports without that collision.
 */
export function configureApp(app: NestFastifyApplication): void {
  // /v1 URI versioning (docs/07 §7.1). Deliberately NOT also calling
  // `setGlobalPrefix` — see the comment in `main.ts` (Bloc 0.5 fix, docs/18
  // §14): combining both doubles the prefix to `/v1/v1/...`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter());

  // FEAT-022: a photo sent as the request's body (5 MB) on the applications' upload routes.
  registerPhotoUploads(app);
}
