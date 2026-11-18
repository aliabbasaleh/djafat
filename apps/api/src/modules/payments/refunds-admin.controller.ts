import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole, RequireStepUp } from '../auth/decorators';
import { PaymentsService } from './payments.service';
import { CompleteRefundSchema, type CompleteRefundInput } from './dto/complete-refund.schema';

/**
 * The refunds operations still have to handle (PAY-04): automatic refunds of
 * orders that ended without delivery, paid through a merchant wallet (sent
 * back by hand) or refused by the provider.
 */
@ApiTags('admin')
@Controller('admin/refunds')
export class RefundsAdminController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  /** `pending` and `failed` refunds, oldest first. */
  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('payments:refund')
  list() {
    return this.payments.listOpenRefunds();
  }

  /**
   * Operations sent the money back by hand: records the transfer reference,
   * marks the refund succeeded and posts its ledger entries. A financial
   * action, so it needs a recent MFA step-up (docs/05 §5.4), like a refund.
   */
  @Post(':id/complete')
  @HttpCode(200)
  @RequireAuth()
  @RequireStepUp()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('payments:refund')
  async complete(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CompleteRefundSchema)) body: CompleteRefundInput,
  ) {
    const refund = await this.payments.completeRefundByHand(id, body.providerRef);
    await this.audit.log({
      actorUserId: actor.userId,
      action: 'REFUND_COMPLETED_BY_HAND',
      entityType: 'refund',
      entityId: id,
      after: { status: refund.status, providerRef: body.providerRef },
    });
    return refund;
  }
}
