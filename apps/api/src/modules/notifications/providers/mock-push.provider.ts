import { Injectable, Logger } from '@nestjs/common';
import type { PushPort } from '@djafat/types';

/**
 * The permanent dev/CI push transport (Bloc 7, docs/27 §16) — same
 * "mock is a first-class citizen, not a stub" philosophy as
 * `MockOtpDeliveryProvider` and `MockPaymentProvider`.
 *
 * No real provider is wired in this bloc: `apps/mobile` has no
 * `expo-notifications` dependency and no push credentials exist anywhere in
 * this repository (verified by inspection, docs/27 §16) — there is nothing to
 * call. Plugging in a real one (Expo push / FCM / APNs) means implementing
 * `PushPort` and swapping the DI binding in `NotificationsModule`; nothing
 * else in this bloc's code changes.
 *
 * Never logs the token (docs/27 §16, §19) — a push token is exactly the kind
 * of secret OTP codes and payment details already stay out of logs for.
 */
@Injectable()
export class MockPushProvider implements PushPort {
  private readonly logger = new Logger(MockPushProvider.name);

  async send(input: {
    token: string;
    platform: 'ios' | 'android' | 'web';
    titleKey: string;
    bodyKey: string;
    data: Record<string, string>;
  }): Promise<{ delivered: boolean; shouldRevoke: boolean }> {
    await Promise.resolve();
    this.logger.debug(
      `[mock-push] would deliver "${input.titleKey}" to a ${input.platform} device (${redactToken(input.token)})`,
    );
    return { delivered: true, shouldRevoke: false };
  }
}

function redactToken(token: string): string {
  return token.length > 4 ? `${'*'.repeat(token.length - 4)}${token.slice(-4)}` : '****';
}
