import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { FieldValidationError, LedgerError, MoneyError, OrderTransitionError } from '@djafat/core';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@djafat/types';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(): { host: ArgumentsHost; getBody: () => ApiErrorBody; getStatus: () => number } {
  let sentBody: ApiErrorBody | undefined;
  let sentStatus: number | undefined;
  const res = {
    status: (code: number) => {
      sentStatus = code;
      return res;
    },
    send: (body: ApiErrorBody) => {
      sentBody = body;
    },
  };
  const req = { id: 'trace-123', headers: {} };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, getBody: () => sentBody!, getStatus: () => sentStatus! };
}

describe('AllExceptionsFilter', () => {
  it('a 409 ConflictException with an explicit non-idempotency code reports THAT code, not IDEMPOTENCY_KEY_REUSED (regression)', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(
      new ConflictException({ code: 'ORDER_INVALID_TRANSITION', message: 'bad transition' }),
      host,
    );
    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(getBody().error.message).toBe('bad transition');
  });

  it('a Bloc-4 cart code (CART_RESTAURANT_MISMATCH) survives the filter instead of falling back to IDEMPOTENCY_KEY_REUSED (regression)', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(
      new ConflictException({ code: 'CART_RESTAURANT_MISMATCH', message: 'restaurant mismatch' }),
      host,
    );
    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('CART_RESTAURANT_MISMATCH');
  });

  it('a 409 ConflictException with NO explicit code falls back to IDEMPOTENCY_KEY_REUSED (existing behaviour preserved)', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new ConflictException('generic conflict'), host);
    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects a bogus/unknown code value and falls back to the status-based guess', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody } = makeHost();
    filter.catch(new NotFoundException({ code: 'NOT_A_REAL_CODE', message: 'x' }), host);
    expect(getBody().error.code).toBe('NOT_FOUND');
  });

  it('a plain UnauthorizedException (no body) maps to UNAUTHENTICATED via the status fallback', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new UnauthorizedException(), host);
    expect(getStatus()).toBe(401);
    expect(getBody().error.code).toBe('UNAUTHENTICATED');
  });

  it('an explicit code wins over the status-derived guess even on a re-used HTTP status', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    // 401 would normally map to UNAUTHENTICATED — OTP_LOCKED here proves the
    // explicit code takes priority, exactly like the 409 case above.
    filter.catch(new UnauthorizedException({ code: 'OTP_LOCKED', message: 'locked' }), host);
    expect(getStatus()).toBe(401);
    expect(getBody().error.code).toBe('OTP_LOCKED');
  });

  it('a ZodError maps to VALIDATION_ERROR (422) with field-level details', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    const zodError = new ZodError([{ code: 'custom', path: ['phone'], message: 'Invalid phone' }]);
    filter.catch(zodError, host);
    expect(getStatus()).toBe(422);
    expect(getBody().error.code).toBe('VALIDATION_ERROR');
    expect(getBody().error.details).toEqual([{ path: 'phone', message: 'Invalid phone' }]);
  });

  it('a MoneyError CURRENCY_MISMATCH maps to CURRENCY_MISMATCH', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody } = makeHost();
    filter.catch(new MoneyError('CURRENCY_MISMATCH', 'currency mismatch'), host);
    expect(getBody().error.code).toBe('CURRENCY_MISMATCH');
  });

  it('a LedgerError never leaks internals — always INTERNAL/500', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new LedgerError('UNBALANCED_ENTRY_GROUP', 'debit != credit'), host);
    expect(getStatus()).toBe(500);
    expect(getBody().error.code).toBe('INTERNAL');
  });

  it('an OrderTransitionError maps to ORDER_INVALID_TRANSITION (409)', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new OrderTransitionError('placed', 'awaiting_payment'), host);
    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('ORDER_INVALID_TRANSITION');
  });

  it('an unknown thrown value never leaks details — generic INTERNAL/500', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(new Error('some internal stack trace detail'), host);
    expect(getStatus()).toBe(500);
    expect(getBody().error.code).toBe('INTERNAL');
    expect(getBody().error.message).toBe('Internal server error');
  });

  it('always includes the traceId from the request', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody } = makeHost();
    filter.catch(new NotFoundException({ code: 'NOT_FOUND', message: 'x' }), host);
    expect(getBody().error.traceId).toBe('trace-123');
  });
});

describe('AllExceptionsFilter — a malformed identifier is a 400, not a 500 (pilot fix, docs/36)', () => {
  // The pilot hit this on `GET /v1/payments/:id` with a non-UUID id: no
  // `@Param('id')` route in the API validates the format, so the string
  // reached Postgres's `uuid` column and Prisma raised P2023, which this
  // filter did not recognise — a raw 500 for what is plainly a client error.
  // Classified centrally so no route can be forgotten.
  function prismaP2023(): unknown {
    // Shaped exactly like `PrismaClientKnownRequestError`, matched
    // structurally by the filter (it must not import `@prisma/client`).
    const err = new Error(
      'Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1',
    ) as Error & { code: string; clientVersion: string };
    err.code = 'P2023';
    err.clientVersion = '6.2.1';
    return err;
  }

  it('maps Prisma P2023 to 400 VALIDATION_ERROR', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(prismaP2023(), host);
    expect(getStatus()).toBe(400);
    expect(getBody().error.code).toBe('VALIDATION_ERROR');
  });

  it('never echoes the offending value or the Prisma internals back to the caller', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody } = makeHost();
    filter.catch(prismaP2023(), host);
    expect(getBody().error.message).toBe('Malformed identifier.');
    expect(getBody().error.message).not.toContain('urn:uuid');
    expect(getBody().error.message).not.toContain('Inconsistent column data');
  });

  it('a different Prisma error code still falls through to INTERNAL — only P2023 is reclassified', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    const other = new Error('Unique constraint failed') as Error & { code: string };
    other.code = 'P2002';
    filter.catch(other, host);
    expect(getStatus()).toBe(500);
    expect(getBody().error.code).toBe('INTERNAL');
  });

  it('a plain object carrying code P2023 is handled too (no instanceof assumption)', () => {
    const filter = new AllExceptionsFilter();
    const { host, getStatus } = makeHost();
    filter.catch({ code: 'P2023', message: 'whatever' }, host);
    expect(getStatus()).toBe(400);
  });

  // Found by the pilot's own security review: the P2023 fix covered typed
  // Prisma queries but NOT the raw ones that cast `::uuid` (e.g. `addresses`),
  // which fail as P2010 wrapping PostgreSQL 22P02 — still a 500 until now.
  it('maps a raw-query failure wrapping PostgreSQL 22P02 to 400 as well', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    const err = new Error(
      'Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `22P02`. Message: `ERROR: invalid input syntax for type uuid: "not-a-uuid"`',
    ) as Error & { code: string; meta: { code: string } };
    err.code = 'P2010';
    err.meta = { code: '22P02' };
    filter.catch(err, host);
    expect(getStatus()).toBe(400);
    expect(getBody().error.code).toBe('VALIDATION_ERROR');
    expect(getBody().error.message).toBe('Malformed identifier.');
  });

  it('a raw-query failure for an UNRELATED PostgreSQL error still reports INTERNAL', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    const err = new Error(
      'Raw query failed. Code: `40P01`. Message: `deadlock detected`',
    ) as Error & {
      code: string;
      meta: { code: string };
    };
    err.code = 'P2010';
    err.meta = { code: '40P01' };
    filter.catch(err, host);
    expect(getStatus()).toBe(500);
    expect(getBody().error.code).toBe('INTERNAL');
  });

  // Found by the full customer-journey run: `Content-Type: application/json`
  // with an empty body is a client error (Fastify FST_ERR_CTP_EMPTY_JSON_BODY,
  // statusCode 400) — it used to surface as an opaque 500 INTERNAL.
  it('a framework client error (Fastify statusCode 4xx) keeps its 4xx as VALIDATION_ERROR, never a 500', () => {
    const { host, getBody, getStatus } = makeHost();
    const err = Object.assign(
      new Error("Body cannot be empty when content-type is set to 'application/json'"),
      {
        code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
        statusCode: 400,
      },
    );
    new AllExceptionsFilter().catch(err, host);
    expect(getStatus()).toBe(400);
    expect(getBody().error.code).toBe('VALIDATION_ERROR');
    expect(getBody().error.message).toContain('Body cannot be empty');

    // a 5xx-looking framework error is still an opaque INTERNAL (no leak)
    const other = makeHost();
    new AllExceptionsFilter().catch(
      Object.assign(new Error('boom'), { statusCode: 500 }),
      other.host,
    );
    expect(other.getStatus()).toBe(500);
    expect(other.getBody().error.code).toBe('INTERNAL');
  });

  // FEAT-020 review #8: a service-level field rule answers like a schema failure.
  it('a FieldValidationError maps to 422 VALIDATION_ERROR with its details per field', () => {
    const filter = new AllExceptionsFilter();
    const { host, getBody, getStatus } = makeHost();
    filter.catch(
      new FieldValidationError([{ path: 'newPassword', message: 'Trop proche de votre nom.' }]),
      host,
    );
    expect(getStatus()).toBe(422);
    expect(getBody().error.code).toBe('VALIDATION_ERROR');
    expect(getBody().error.details).toEqual([
      { path: 'newPassword', message: 'Trop proche de votre nom.' },
    ]);
  });
});
