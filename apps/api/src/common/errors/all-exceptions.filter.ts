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
