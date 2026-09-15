import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole, RequireStepUp } from '../auth/decorators';
import { SettlementsService } from './settlements.service';
import { RecordSettlementSchema, type RecordSettlementInput } from './dto/record-settlement.schema';

/**
 * Admin-only settlement primitive (docs/08 §8.9 "Settlement & réconciliation").
 * A financial write, so the full step-up-gated stack applies, same as
 * `admin.controller.ts`'s `sensitive-ping` proves out.
 */
@ApiTags('admin')
@Controller('admin/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('ledger:read')
  list() {
    return this.settlements.listSettlements();
  }

  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('payouts:write')
  @RequireStepUp()
  async record(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(RecordSettlementSchema)) body: RecordSettlementInput,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    return this.settlements.recordSettlement(body, idempotencyKey, actor.userId);
  }
}
