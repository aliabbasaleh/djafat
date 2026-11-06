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
import { OTP_DELIVERY_PORT } from './otp-delivery.token';
import { MockOtpDeliveryProvider } from './providers/mock-otp-delivery.provider';
import { HttpSmsOtpDeliveryProvider } from './providers/http-sms-otp-delivery.provider';
import { AppConfigService } from '../../common/config/config.service';
import { RedisService } from '../../common/redis/redis.service';

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
  controllers: [AuthController, MeController],
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
    // FEAT-006: the OTP transport is chosen by `SMS_PROVIDER`. `loadApiEnv`
    // already refuses `mock` in production and `http` without a URL, so this
    // map can never wire a provider that silently sends nothing in prod.
    {
      provide: OTP_DELIVERY_PORT,
      useFactory: (config: AppConfigService, redis: RedisService) =>
        ({
          mock: () => new MockOtpDeliveryProvider(redis, config),
          http: () => new HttpSmsOtpDeliveryProvider(config),
        })[config.get('SMS_PROVIDER')](),
      inject: [AppConfigService, RedisService],
    },
  ],
  exports: [ActorResolverService, SessionService, TokenService],
})
export class AuthModule {}
