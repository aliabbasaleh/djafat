import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '@djafat/types';
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
      const message =
        typeof resp === 'string'
          ? resp
          : ((resp as { message?: string }).message ?? exception.message);
      return { status, code: this.httpStatusToCode(status), message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Internal server error',
    };
  }

  private httpStatusToCode(status: number): ApiErrorCode {
    switch (status) {
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
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }
}
