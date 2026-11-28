import { Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { WhatsappInboundService } from './whatsapp-inbound.service';

/**
 * Meta → DJAFAT webhook for the WhatsApp number (FEAT-008, SPEC-008-02).
 * Provider-to-server, never a user: no `@RequireAuth()`; authenticity is the
 * `X-Hub-Signature-256` HMAC over the raw body (kept by `rawBody: true`,
 * `main.ts`). A signed request gets 200 so Meta does not redeliver — except
 * when the server fails half-way: 500, and Meta's redelivery is processed
 * (FEAT-023, SPEC-023-02 R1).
 */
@ApiTags('auth')
@Controller('auth/whatsapp/webhook')
export class WhatsappWebhookController {
  constructor(private readonly inbound: WhatsappInboundService) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    return this.inbound.verifySubscription(mode, token, challenge);
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: FastifyRequest,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ status: 'ok' }> {
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    await this.inbound.handle(rawBody, signature);
    return { status: 'ok' };
  }
}
