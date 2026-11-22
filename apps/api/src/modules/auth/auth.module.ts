import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { ActorResolverService } from './actor-resolver.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { OwnershipGuard } from './guards/ownership.guard';
import { StepUpGuard } from './guards/step-up.guard';
import {
  OTP_DELIVERY_PORT,
  OTP_EMAIL_DELIVERY_PORT,
  OTP_WHATSAPP_DELIVERY_PORT,
} from './otp-delivery.token';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappTextReplyService } from './whatsapp-text-reply.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { DisabledSmsOtpDeliveryProvider } from './providers/disabled-sms-otp-delivery.provider';
import { MockWhatsappOtpDeliveryProvider } from './providers/mock-whatsapp-otp-delivery.provider';
import { CloudWhatsappOtpDeliveryProvider } from './providers/cloud-whatsapp-otp-delivery.provider';
import { SmtpEmailOtpDeliveryProvider } from './providers/smtp-email-otp-delivery.provider';
import { MockEmailOtpDeliveryProvider } from './providers/mock-email-otp-delivery.provider';
import { MockOtpDeliveryProvider } from './providers/mock-otp-delivery.provider';
import { HttpSmsOtpDeliveryProvider } from './providers/http-sms-otp-delivery.provider';
import { AppConfigService } from '../../common/config/config.service';
import { RedisService } from '../../common/redis/redis.service';
import { ACCOUNT_NOTICE_PORT } from './account-notice.port';
import { MockAccountNoticeProvider } from './providers/mock-account-notice.provider';
import { SmtpAccountNoticeProvider } from './providers/smtp-account-notice.provider';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { PasswordService } from './password.service';
import { PasswordController } from './password.controller';
import { TrustedDeviceService } from './trusted-device.service';
import { PhoneLinkService } from './phone-link.service';

/**
 * Identity & Access (Bloc 1, docs/19). Depends only on `users` (docs/19 §43
 * DAG — `auth`/`users` are the foundational layer everything else sits on;
 * neither depends on a business module). Exports the guards/decorators'
 * underlying services so DAG-allowed business modules can inject
 * `ActorResolverService`/`SessionService` directly where a decorator alone
 * isn't enough (e.g. a controller resolving an ownership check manually).
 */
@Module({
  imports: [UsersModule],
  controllers: [
    AuthController,
    MeController,
    WhatsappWebhookController,
    RegistrationController, // FEAT-020
    PasswordController, // FEAT-020
  ],
  providers: [
    AuthService,
    OtpService,
    SessionService,
    TokenService,
    MfaService,
    ActorResolverService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    OwnershipGuard,
    StepUpGuard,
    WhatsappInboundService,
    WhatsappTextReplyService,
    // FEAT-020 — customer accounts with an email and a password.
    RegistrationService,
    PasswordService,
    TrustedDeviceService,
    PhoneLinkService,
    // FEAT-020 (SPEC-020-01 R6): notices without a code, same choice as the codes.
    {
      provide: ACCOUNT_NOTICE_PORT,
      useFactory: (config: AppConfigService, redis: RedisService) =>
        ({
          mock: () => new MockAccountNoticeProvider(redis, config),
          smtp: () => new SmtpAccountNoticeProvider(config),
        })[config.get('EMAIL_PROVIDER')](),
      inject: [AppConfigService, RedisService],
    },
    // FEAT-006: the OTP transport is chosen by `SMS_PROVIDER`. `loadApiEnv`
    // already refuses `mock` in production and `http` without a URL, so this
    // map can never wire a provider that silently sends nothing in prod.
    {
      provide: OTP_DELIVERY_PORT,
      useFactory: (config: AppConfigService, redis: RedisService) =>
        ({
          mock: () => new MockOtpDeliveryProvider(redis, config),
          http: () => new HttpSmsOtpDeliveryProvider(config),
          disabled: () => new DisabledSmsOtpDeliveryProvider(), // FEAT-008: no paid SMS at launch
        })[config.get('SMS_PROVIDER')](),
      inject: [AppConfigService, RedisService],
    },
    // FEAT-007: email channel of the same port, chosen by `EMAIL_PROVIDER`.
    // Optional feature: in production without SMTP the mock answers 503
    // EMAIL_UNAVAILABLE instead of blocking boot (SMS login keeps working).
    {
      provide: OTP_EMAIL_DELIVERY_PORT,
      useFactory: (config: AppConfigService, redis: RedisService) =>
        ({
          mock: () => new MockEmailOtpDeliveryProvider(redis, config),
          smtp: () => new SmtpEmailOtpDeliveryProvider(config),
        })[config.get('EMAIL_PROVIDER')](),
      inject: [AppConfigService, RedisService],
    },
    // FEAT-008: WhatsApp channel, chosen by `WHATSAPP_PROVIDER`. `loadApiEnv`
    // refuses `cloud` without its credentials; the mock answers 503 in production.
    {
      provide: OTP_WHATSAPP_DELIVERY_PORT,
      useFactory: (config: AppConfigService, redis: RedisService) =>
        ({
          mock: () => new MockWhatsappOtpDeliveryProvider(redis, config),
          cloud: () => new CloudWhatsappOtpDeliveryProvider(config),
        })[config.get('WHATSAPP_PROVIDER')](),
      inject: [AppConfigService, RedisService],
    },
  ],
  exports: [ActorResolverService, SessionService, TokenService, WhatsappTextReplyService],
})
export class AuthModule {}
