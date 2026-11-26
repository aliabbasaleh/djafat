import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { RequestMeta } from './auth.service';
import {
  WhatsappStartSchema,
  WhatsappStatusSchema,
  type WhatsappStartInput,
  type WhatsappStatusInput,
} from './dto/whatsapp.schema';
import { ReqMeta } from './request-meta.decorator';
import { WhatsappCodeService } from './whatsapp-code.service';

/**
 * Free WhatsApp login (FEAT-023): the code a customer SENDS to DJAFAT, and the
 * screen waiting for it. Public like the other logins; the screen's token is
 * the proof (SPEC-023-03 « Autorisations »). Meta's webhook stays on
 * `WhatsappWebhookController`.
 */
@ApiTags('auth')
@Controller('auth/whatsapp')
export class WhatsappController {
  constructor(private readonly codes: WhatsappCodeService) {}

  /** SPEC-023-01: a code to send — a login, or a new device's code with `challengeId`. */
  @Post('start')
  @HttpCode(201)
  start(
    @Body(new ZodValidationPipe(WhatsappStartSchema)) body: WhatsappStartInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.codes.startLogin({ challengeId: body.challengeId }, meta);
  }

  /** SPEC-023-03: waiting, then the outcome once (a session, or why not). */
  @Post('status')
  @HttpCode(200)
  status(
    @Body(new ZodValidationPipe(WhatsappStatusSchema)) body: WhatsappStatusInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.codes.status(body, meta);
  }
}
