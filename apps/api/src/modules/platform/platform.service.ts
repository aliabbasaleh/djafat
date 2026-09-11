import { Injectable, NotFoundException } from '@nestjs/common';
import { PLATFORM_SETTINGS_DEFAULTS } from '@djafat/config';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PublicConfig {
  country: { iso: string; currency: string; timezone: string; defaultLocale: string };
  city: { slug: string; name: string; timezone: string };
  unpaidOrderTtlSeconds: number;
  featureFlags: Record<string, boolean>;
  minAppVersion: { android: string; ios: string };
}

/**
 * Reads market configuration (countries / cities / currencies / settings /
 * payment-provider availability / commission & tax rules). At Bloc 0 it only
 * needs to answer `GET /v1/config/public`. Nothing here assumes Chad/XAF —
 * the launch market is a seeded row (docs/06 §6.14).
 */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig(citySlug?: string): Promise<PublicConfig> {
    const city = citySlug
      ? await this.prisma.city.findFirst({ where: { slug: citySlug, active: true } })
      : await this.prisma.city.findFirst({ where: { active: true }, orderBy: { name: 'asc' } });

    if (!city)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No active city configured.' });

    const country = await this.prisma.country.findUniqueOrThrow({ where: { id: city.countryId } });

    const ttlRow = await this.prisma.platformSetting.findFirst({
      where: { key: 'unpaid_order_ttl_seconds', scope: 'global' },
    });
    const unpaidOrderTtlSeconds =
      typeof ttlRow?.value === 'number'
        ? ttlRow.value
        : PLATFORM_SETTINGS_DEFAULTS.unpaid_order_ttl_seconds;

    const flags = await this.prisma.featureFlag.findMany({ select: { key: true, enabled: true } });

    return {
      country: {
        iso: country.isoCode,
        currency: country.currency,
        timezone: country.timezone,
        defaultLocale: country.defaultLocale,
      },
      city: { slug: city.slug, name: city.name, timezone: city.timezone },
      unpaidOrderTtlSeconds,
      featureFlags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
      minAppVersion: { android: '1.0.0', ios: '1.0.0' },
    };
  }

  /** `platform_settings['unpaid_order_ttl_seconds']` (decision A4) — no magic number. */
  async getUnpaidOrderTtlSeconds(): Promise<number> {
    const row = await this.prisma.platformSetting.findFirst({
      where: { key: 'unpaid_order_ttl_seconds', scope: 'global' },
    });
    return typeof row?.value === 'number'
      ? row.value
      : PLATFORM_SETTINGS_DEFAULTS.unpaid_order_ttl_seconds;
  }

  // ── Bloc 1 — Identity & Access (docs/19 §7-§8) ────────────────────────────

  private async getNumberSetting(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.platformSetting.findFirst({ where: { key, scope: 'global' } });
    return typeof row?.value === 'number' ? row.value : fallback;
  }

  async getOtpTtlSeconds(): Promise<number> {
    return this.getNumberSetting('otp_ttl_seconds', PLATFORM_SETTINGS_DEFAULTS.otp_ttl_seconds);
  }

  async getOtpMaxAttempts(): Promise<number> {
    return this.getNumberSetting('otp_max_attempts', PLATFORM_SETTINGS_DEFAULTS.otp_max_attempts);
  }

  async getPhoneLockThreshold(): Promise<number> {
    return this.getNumberSetting(
      'phone_lock_threshold',
      PLATFORM_SETTINGS_DEFAULTS.phone_lock_threshold,
    );
  }

  async getPhoneLockDurationSeconds(): Promise<number> {
    return this.getNumberSetting(
      'phone_lock_duration_seconds',
      PLATFORM_SETTINGS_DEFAULTS.phone_lock_duration_seconds,
    );
  }

  private async getRateLimitSetting(
    key: string,
    fallback: { limit: number; window_seconds: number },
  ): Promise<{ limit: number; windowSeconds: number }> {
    const row = await this.prisma.platformSetting.findFirst({ where: { key, scope: 'global' } });
    const v = row?.value as { limit?: unknown; window_seconds?: unknown } | undefined;
    const limit = typeof v?.limit === 'number' ? v.limit : fallback.limit;
    const windowSeconds =
      typeof v?.window_seconds === 'number' ? v.window_seconds : fallback.window_seconds;
    return { limit, windowSeconds };
  }

  getOtpRateLimitPerPhone(): Promise<{ limit: number; windowSeconds: number }> {
    return this.getRateLimitSetting(
      'otp_rate_limit_per_phone',
      PLATFORM_SETTINGS_DEFAULTS.otp_rate_limit_per_phone,
    );
  }

  getOtpRateLimitPerIp(): Promise<{ limit: number; windowSeconds: number }> {
    return this.getRateLimitSetting(
      'otp_rate_limit_per_ip',
      PLATFORM_SETTINGS_DEFAULTS.otp_rate_limit_per_ip,
    );
  }
}
