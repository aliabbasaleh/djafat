import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';

/**
 * Registered as a top-level `/config/*` route (docs/08 §8.4 step 2), NOT
 * nested under `/payments`, even though it lives in the `payments` module —
 * only `payments` can see both the registered `PaymentProvider` CLASSES and
 * the `payment_provider_configs` rows, and `platform` (L0) may not depend on
 * `payments` (L5) to expose this itself (docs/15 §7 DAG).
 */
@ApiTags('config')
@Controller('config')
export class PaymentMethodsConfigController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payment-methods')
  list(
    @Query('cityId') cityId?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('amount') amountMinor?: string,
    @Query('currency') currency?: string,
  ) {
    let parsedAmount: bigint | undefined;
    if (amountMinor !== undefined) {
      if (!/^\d+$/.test(amountMinor)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'amount must be a plain non-negative integer string.',
        });
      }
      parsedAmount = BigInt(amountMinor);
    }
    return this.payments.listAvailablePaymentMethods({
      ...(cityId !== undefined ? { cityId } : {}),
      ...(restaurantId !== undefined ? { restaurantId } : {}),
      ...(parsedAmount !== undefined ? { amountMinor: parsedAmount } : {}),
      ...(currency !== undefined ? { currency } : {}),
    });
  }
}
