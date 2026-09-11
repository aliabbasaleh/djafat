import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

/**
 * The request-handling wiring shared by the real process (`main.ts`) and the
 * integration test harness (`test/walking-skeleton.int.spec.ts`). Kept as one
 * function so the two can never drift apart — e.g. the test previously would
 * have silently NOT exercised the raw-body webhook parser or URI versioning
 * if each place reimplemented this by hand (docs/18 §14).
 */
export function configureApp(app: NestFastifyApplication): void {
  // Preserve the exact raw body alongside the parsed JSON — webhook signature
  // verification (docs/08 §8.6) MUST hash/HMAC the bytes as sent, not a
  // re-serialised object (key order/whitespace would break the signature).
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      if (body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

  // /v1 URI versioning (docs/07 §7.1). Deliberately NOT also calling
  // `setGlobalPrefix` — see the comment in `main.ts` (Bloc 0.5 fix, docs/18
  // §14): combining both doubles the prefix to `/v1/v1/...`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter());
}
