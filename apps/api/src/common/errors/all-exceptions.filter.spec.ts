import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { LedgerError, MoneyError, OrderTransitionError } from '@djafat/core';
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
