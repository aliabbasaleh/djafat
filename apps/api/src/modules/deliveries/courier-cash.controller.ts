import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { CourierCashService } from './courier-cash.service';
import { CourierEarningsService } from './courier-earnings.service';

/** Cash a courier holds, the ceiling and the blocked state (FEAT-010, SPEC-010-03). */
@ApiTags('deliveries')
@Controller()
export class CourierCashController {
  constructor(
    private readonly cash: CourierCashService,
    private readonly earnings: CourierEarningsService,
  ) {}

  /** FEAT-014: today, this week, each course's fee, balance to receive. */
  @Get('couriers/me/earnings')
  @RequireAuth()
  @RequireRole('courier')
  myEarnings(@CurrentActor() actor: AuthenticatedActor) {
    return this.earnings.getEarnings(actor.userId);
  }

  @Get('couriers/me/cash')
  @RequireAuth()
  @RequireRole('courier')
  mine(@CurrentActor() actor: AuthenticatedActor) {
    return this.cash.getCashStatus(actor.userId);
  }

  @Get('deliveries/couriers/:courierId/cash')
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance', 'support')
  forCourier(@Param('courierId') courierId: string) {
    return this.cash.getCashStatus(courierId);
  }
}
