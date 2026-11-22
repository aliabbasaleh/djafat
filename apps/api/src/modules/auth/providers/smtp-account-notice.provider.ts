import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../../common/config/config.service';
import type { AccountNotice, AccountNoticePort, NoticeOutcome } from '../account-notice.port';
import { maskEmail } from '../masking';
import { accountNoticeMessage } from './account-notice-text';
import { smtpSender, smtpSettingsFrom, smtpTransportOptions } from './smtp-options';

/**
 * Account notices by SMTP (FEAT-020, SPEC-020-01 R6), same server as the
 * codes. Never throws: a notice that cannot leave is logged (SMTP error code,
 * masked address) and the request that sent it still succeeds.
 */
@Injectable()
export class SmtpAccountNoticeProvider implements AccountNoticePort {
  private readonly logger = new Logger(SmtpAccountNoticeProvider.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  async send(notice: AccountNotice): Promise<NoticeOutcome> {
    const { subject, text } = accountNoticeMessage(notice);
    const to = maskEmail(notice.to);
    try {
      const settings = smtpSettingsFrom(this.config);
      this.transporter ??= createTransport(smtpTransportOptions(settings));
      await this.transporter.sendMail({ from: smtpSender(settings), to: notice.to, subject, text });
      this.logger.log(`Account notice "${notice.kind}" accepted by SMTP server for ${to}`);
      return 'sent';
    } catch (err) {
      const reason =
        err instanceof Error && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'smtp error';
      this.logger.error(`Account notice "${notice.kind}" not sent to ${to}: ${reason}`);
      return 'failed';
    }
  }
}
