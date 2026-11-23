import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { RequestMeta } from './auth.service';

/**
 * The caller's network address and user agent, for budgets, audit and the
 * label of a remembered device (FEAT-020) — same reading as `requestMeta` in
 * `auth.controller.ts`.
 */
export const ReqMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const ua = req.headers['user-agent'];
    return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
  },
);
