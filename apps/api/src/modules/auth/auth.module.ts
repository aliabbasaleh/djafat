import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Real content in Bloc 1: phone + OTP (hashed, TTL, durable
 * lockout), JWT access + rotating refresh with token family, RBAC guards,
 * step-up MFA. OTP delivery goes through `OtpDeliveryPort` (decision A9).
 * DAG: `auth` depends only on `platform`.
 */
@Module({})
export class AuthModule {}
