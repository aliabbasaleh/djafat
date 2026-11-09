import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../../auth/decorators';
import { RegisterSmsGatewaySchema, type RegisterSmsGatewayBody } from '../dto/mobile-money.schema';
import { SmsIngestService } from './sms-ingest.service';

const STAFF = ['admin', 'super_admin', 'finance'] as const;

/** Merchant SMS gateways (FEAT-016, SPEC-016-02). */
@ApiTags('payments')
@Controller()
export class SmsIngestController {
  constructor(private readonly sms: SmsIngestService) {}

  /**
   * Device-to-server, never a user: no `@RequireAuth()`. Authenticity is the
   * HMAC over `${timestamp}.${raw body}` with the device's own secret
   * (raw body kept by `rawBody: true`, like the WhatsApp webhook).
   */
  @Post('payments/mobile-money/sms-gateways/:deviceId/messages')
  @HttpCode(200)
  ingest(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() req: FastifyRequest,
    @Headers('x-djafat-timestamp') timestamp?: string,
    @Headers('x-djafat-signature') signature?: string,
  ) {
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    return this.sms.ingest(deviceId, { timestamp, signature }, rawBody.toString('utf8'));
  }

  @Post('admin/sms-gateways')
  @HttpCode(201)
  @RequireAuth()
  @RequireRole(...STAFF)
  register(
    @Body(new ZodValidationPipe(RegisterSmsGatewaySchema)) body: RegisterSmsGatewayBody,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.sms.registerDevice(body.providerCode, body.label, actor.userId);
  }

  @Get('admin/sms-gateways')
  @RequireAuth()
  @RequireRole(...STAFF)
  list() {
    return this.sms.listDevices();
  }

  @Get('admin/sms-gateways/review')
  @RequireAuth()
  @RequireRole(...STAFF)
  review() {
    return this.sms.listForReview();
  }
}
