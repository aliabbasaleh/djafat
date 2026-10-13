import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { API_ERROR_CODES, type ApiErrorBody, type ApiErrorCode } from '@djafat/types';
import { LedgerError, MoneyError, OrderTransitionError } from '@djafat/core';
import { ZodError } from 'zod';
import { CORRELATION_ID_HEADER } from '@djafat/config';

/**
 * Turns every thrown error into the platform's single response envelope:
 * `{ error: { code, message, details?, traceId } }` (docs/05 §5.4, docs/07 §7.1).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const traceId =
      (req.id as string | undefined) ?? String(req.headers[CORRELATION_ID_HEADER] ?? '');

    const { status, code, message, details } = this.classify(exception);

    if (status >= 500) {
      this.logger.error({ err: exception, traceId }, `Unhandled error: ${message}`);
    }

    const body: ApiErrorBody = {
      error: { code, message, traceId, ...(details !== undefined ? { details } : {}) },
    };
    void res.status(status).send(body);
  }

  private classify(exception: unknown): {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (exception instanceof MoneyError) {
      const code: ApiErrorCode =
        exception.code === 'CURRENCY_MISMATCH' ? 'CURRENCY_MISMATCH' : 'VALIDATION_ERROR';
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code, message: exception.message };
    }
    if (exception instanceof LedgerError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL',
        message: exception.message,
      };
    }
    if (exception instanceof OrderTransitionError) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'ORDER_INVALID_TRANSITION',
        message: exception.message,
      };
    }
    // A malformed identifier is a CLIENT error, not an internal one. Prisma
    // reports "Inconsistent column data: Error creating UUID" as P2023 when a
    // non-UUID string reaches a `uuid` column — which happens on every
    // `@Param('id')` route, none of which validates the format (the pilot hit
    // it on `GET /v1/payments/:id`, docs/36). Classified centrally rather
    // than by adding a pipe to ~40 route signatures: one place to be right,
    // and no route can be forgotten. The message stays generic — it must not
    // echo the offending value back.
    if (isPrismaMalformedIdError(exception)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Malformed identifier.',
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const respObj =
        typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>) : undefined;
      const message =
        typeof resp === 'string'
          ? resp
          : ((respObj?.['message'] as string | undefined) ?? exception.message);
      // Bug fix (docs/19 §30): every throw site across the codebase already
      // passes an explicit `code` (e.g. `ConflictException({ code:
      // 'ORDER_INVALID_TRANSITION', ... })`) — this filter used to silently
      // DISCARD it and derive `code` purely from the HTTP status instead, so
      // e.g. every 409 reported `IDEMPOTENCY_KEY_REUSED` regardless of what
      // was actually thrown. Prefer the explicit code; fall back to the
      // status-based guess only when none was given.
      const explicitCode = respObj?.['code'];
      const code: ApiErrorCode = isApiErrorCode(explicitCode)
        ? explicitCode
        : this.httpStatusToCode(status);
      return { status, code, message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Internal server error',
    };
  }

  /** Only reached when a thrown `HttpException` carried no explicit `code`. */
  private httpStatusToCode(status: number): ApiErrorCode {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'IDEMPOTENCY_KEY_REUSED';
      case 422:
        return 'VALIDATION_ERROR';
      case 423:
        return 'OTP_LOCKED';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A malformed identifier reaches PostgreSQL in two shapes, and BOTH used to
 * surface as a raw 500 (the pilot found the first, its security review the
 * second — docs/36):
 *
 *   - `P2023` "Inconsistent column data" — a non-UUID string passed to a
 *     typed Prisma query against a `uuid` column (`findUnique({ where: { id }})`);
 *   - `P2010` wrapping PostgreSQL `22P02` "invalid input syntax for type
 *     uuid" — the same mistake through a raw query that casts `::uuid`,
 *     which several services use (e.g. `addresses`).
 *
 * Matched structurally rather than with `instanceof
 * Prisma.PrismaClientKnownRequestError`, so this filter keeps no import of
 * `@prisma/client`: `common/errors` is reachable from every module and must
 * stay free of infrastructure dependencies (docs/05 §5.3). Narrow on purpose:
 * only these two, so an unrelated database fault still reports INTERNAL.
 */
function isPrismaMalformedIdError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  const err = exception as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (err.code === 'P2023') return true;
  if (err.code !== 'P2010') return false;
  return (
    err.meta?.code === '22P02' || (typeof err.message === 'string' && err.message.includes('22P02'))
  );
}
