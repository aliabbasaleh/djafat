import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { OtpDeliveryPort, OtpDeliveryPurpose } from '@djafat/types';
import { AppConfigService } from '../../../common/config/config.service';
import { emailDeliveryFailed } from '../email-delivery-errors';
import { maskEmail } from '../masking';
import { emailOtpMessage } from './email-otp-text';
import { smtpSender, smtpSettingsFrom, smtpTransportOptions } from './smtp-options';

/**
 * Sends login / verification codes by email through any SMTP provider
 * (FEAT-007): Brevo, Mailgun, SES, Workspace… — `SMTP_URL`
 * (`smtp://` or `smtps://user:pass@host:port`), or since FEAT-020 the
 * official Gmail account (`SMTP_HOST`, `SMTP_USER`, app password), and
 * `EMAIL_FROM`. The wording follows the code's purpose (SPEC-020-01 R5).
 * Never logs the code, the full address or the SMTP credentials.
 */
@Injectable()
export class SmtpEmailOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(SmtpEmailOtpDeliveryProvider.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  async send(input: {
    to: string;
    code: string;
    ttlSeconds: number;
    locale: string;
    purpose?: OtpDeliveryPurpose;
  }): Promise<void> {
    const { subject, text } = emailOtpMessage(input.code, input.ttlSeconds, input.purpose);
    const to = maskEmail(input.to);
    const settings = smtpSettingsFrom(this.config);
    try {
      await this.transport().sendMail({ from: smtpSender(settings), to: input.to, subject, text });
      this.logger.log(`OTP email accepted by SMTP server for ${to}`);
    } catch (err) {
      const reason =
        err instanceof Error && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'smtp error';
      this.logger.error(`OTP email delivery failed for ${to}: ${reason}`);
      throw emailDeliveryFailed();
    }
  }

  private transport(): Transporter {
    this.transporter ??= createTransport(smtpTransportOptions(smtpSettingsFrom(this.config)));
    return this.transporter;
  }
}
