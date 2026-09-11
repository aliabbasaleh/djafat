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
    // Only `mock` is wired at Bloc 1 (docs/19 §6) — a real `sms` provider is
    // added the same way `MockPaymentProvider`/`CashPaymentProvider` were:
    // a second class behind the same port, selected by `SMS_PROVIDER` env.
    { provide: OTP_DELIVERY_PORT, useClass: MockOtpDeliveryProvider },
  ],
  exports: [ActorResolverService, SessionService, TokenService],
})
export class AuthModule {}
