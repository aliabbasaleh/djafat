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
import { walletProviders } from './providers/wallet/merchant-wallet-payment.provider';
import { MobileMoneyReceiptsService } from './mobile-money/mobile-money-receipts.service';
import { MobileMoneyController } from './mobile-money/mobile-money.controller';
import { CourierRemittanceService } from './mobile-money/courier-remittance.service';
import { UsersModule } from '../users/users.module';
import { CodTrustService } from './cod-trust.service';
import { SmsIngestService } from './mobile-money/sms-ingest.service';
import { SmsIngestController } from './mobile-money/sms-ingest.controller';
import { CourierPayoutsService } from './mobile-money/courier-payouts.service';
import { CourierPayoutsController } from './mobile-money/courier-payouts.controller';
import { OrderRefundsService } from './order-refunds.service';
import { RefundsAdminController } from './refunds-admin.controller';

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
  imports: [LedgerModule, AuthModule, UsersModule],
  controllers: [
    PaymentsController,
    MobileMoneyController,
    PaymentMethodsConfigController,
    SettlementsController,
    CourierPayoutsController,
    SmsIngestController,
    RefundsAdminController,
  ],
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
          selectRegistrableProviders(
            // FEAT-009: one merchant-wallet provider per configured wallet
            // (`MOBILE_MONEY_WALLETS`); none configured = none registered.
            [cash, mock, ...walletProviders(config.get('MOBILE_MONEY_WALLETS'))],
            { isProduction: config.isProduction },
          ),
        ),
      inject: [AppConfigService, CashPaymentProvider, MockPaymentProvider],
    },
    PaymentsService,
    MobileMoneyReceiptsService,
    CourierRemittanceService,
    CourierPayoutsService,
    CodTrustService,
    SmsIngestService,
    SettlementsService,
    OrderRefundsService,
  ],
  exports: [PaymentProviderRegistry, PaymentsService, MobileMoneyReceiptsService],
})
export class PaymentsModule {}
