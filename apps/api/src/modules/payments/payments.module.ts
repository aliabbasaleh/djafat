import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PAYMENT_PROVIDER } from './payments.tokens';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentMethodsConfigController } from './payment-methods-config.controller';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { CashPaymentProvider } from './providers/cash/cash-payment.provider';
import { MockPaymentProvider } from './providers/mock/mock-payment.provider';
import { selectRegistrableProviders } from './payment-provider-selection';
import { AppConfigService } from '../../common/config/config.service';

/**
 * At Bloc 0 only `cash` and `mock` providers are registered. Real Mobile Money
 * providers (airtel_money, moov_money) and card get their own provider classes
 * in Bloc 5, once access is verified (decision A1). There is deliberately NO
 * placeholder Airtel/Moov integration.
 *
 * `payments` may depend on `ledger` (DAG — docs/05 §5.3) but NEVER on `orders`;
 * it consumes `OrderAmountPort` (from `@djafat/types`) via events instead.
 */
@Module({
  imports: [LedgerModule, AuthModule],
  controllers: [PaymentsController, PaymentMethodsConfigController, SettlementsController],
  providers: [
    CashPaymentProvider,
    MockPaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: CashPaymentProvider },
    { provide: PAYMENT_PROVIDER, useExisting: MockPaymentProvider },
    {
      provide: PaymentProviderRegistry,
      // FEAT-002: in production, sandbox-only providers (mock) are never
      // registered, so creation, webhooks and the payment-methods list all
      // refuse them through `registry.has()` — whatever the database says.
      useFactory: (
        config: AppConfigService,
        cash: CashPaymentProvider,
        mock: MockPaymentProvider,
      ) =>
        new PaymentProviderRegistry(
          selectRegistrableProviders([cash, mock], { isProduction: config.isProduction }),
        ),
      inject: [AppConfigService, CashPaymentProvider, MockPaymentProvider],
    },
    PaymentsService,
    SettlementsService,
  ],
  exports: [PaymentProviderRegistry],
})
export class PaymentsModule {}
