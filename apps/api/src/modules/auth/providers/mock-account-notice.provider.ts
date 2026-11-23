import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/config.service';
import { RedisService } from '../../../common/redis/redis.service';
import type { AccountNotice, AccountNoticePort, NoticeOutcome } from '../account-notice.port';
import { accountNoticeMessage } from './account-notice-text';

/** How long the last notice of an address stays readable in development. */
const MOCK_NOTICE_TTL_SECONDS = 600;

/**
 * Dev/CI notices (FEAT-020, SPEC-020-01 R6), same idea as the email code
 * mock: the last notice of an address is readable in Redis for 10 minutes.
 * In production the mock sends nothing and only warns, without failing the
 * request (a notice is best effort).
 */
@Injectable()
export class MockAccountNoticeProvider implements AccountNoticePort {
  private readonly logger = new Logger(MockAccountNoticeProvider.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async send(notice: AccountNotice): Promise<NoticeOutcome> {
    if (this.config.isProduction) {
      this.logger.warn(
        `Account notice "${notice.kind}" not sent: EMAIL_PROVIDER=mock in production`,
      );
      return 'unavailable';
    }
    const { subject } = accountNoticeMessage(notice);
    await this.redis.client.set(
      mockAccountNoticeKey(notice.to),
      JSON.stringify({ kind: notice.kind, subject }),
      'EX',
      MOCK_NOTICE_TTL_SECONDS,
    );
    return 'sent';
  }
}

export function mockAccountNoticeKey(email: string): string {
  return `mail:mock:${email}`;
}
