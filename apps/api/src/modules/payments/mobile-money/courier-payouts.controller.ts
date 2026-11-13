import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../../auth/decorators';
import { PayoutSentSchema, type PayoutSentBody } from '../dto/mobile-money.schema';
import { CourierPayoutsService } from './courier-payouts.service';
import { earningsPeriodStarts } from '@djafat/core';

const FINANCE = ['admin', 'super_admin', 'finance'] as const;

/** Courier earnings paid to Airtel Money (FEAT-014, SPEC-014-02). */
@ApiTags('payments')
@Controller()
export class CourierPayoutsController {
  constructor(private readonly payouts: CourierPayoutsService) {}

  @Get('couriers/me/payouts')
  @RequireAuth()
  @RequireRole('courier')
  mine(@CurrentActor() actor: AuthenticatedActor) {
    return this.payouts.listMine(actor.userId);
  }

  @Post('couriers/me/payouts')
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('courier')
  request(@CurrentActor() actor: AuthenticatedActor) {
    return this.payouts.requestOnDemand(actor.userId);
  }

  @Get('admin/payouts')
  @RequireAuth()
  @RequireRole(...FINANCE)
  list(@Query('status') status?: string) {
    return this.payouts.listForStaff(status);
  }

  @Post('admin/payouts/weekly')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole(...FINANCE)
  weekly() {
    return this.payouts.prepareWeekly(earningsPeriodStarts(new Date()).weekStart);
  }

  @Post('admin/payouts/:id/sent')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole(...FINANCE)
  sent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PayoutSentSchema)) body: PayoutSentBody,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.payouts.markSent(id, actor.userId, {
      transactionRef: body.transactionRef,
      airtelFeeMinor: body.airtelFeeMinor,
    });
  }
}
