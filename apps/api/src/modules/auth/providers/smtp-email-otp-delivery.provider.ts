import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { OtpDeliveryPort } from '@djafat/types';
import { AppConfigService } from '../../../common/config/config.service';
import { emailOtpMessage } from './email-otp-text';

/**
 * Sends login / verification codes by email through any SMTP provider
 * (FEAT-007): Brevo, Mailgun, SES, Workspace… — `SMTP_URL`
 * (`smtp://` or `smtps://user:pass@host:port`) and `EMAIL_FROM`.
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
  }): Promise<void> {
    const { subject, text } = emailOtpMessage(input.code, input.ttlSeconds);
    const to = redactEmail(input.to);
    try {
      await this.transport().sendMail({
        from: this.config.get('EMAIL_FROM'),
        to: input.to,
        subject,
        text,
      });
      this.logger.log(`OTP email accepted by SMTP server for ${to}`);
    } catch (err) {
      const reason =
        err instanceof Error && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'smtp error';
      this.logger.error(`OTP email delivery failed for ${to}: ${reason}`);
      throw new HttpException(
        {
          code: 'OTP_DELIVERY_FAILED',
          message: "Impossible d'envoyer l'e-mail, réessayez dans un instant.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const url = this.config.get('SMTP_URL');
      if (!url) throw new Error('SMTP_URL is not configured');
      this.transporter = createTransport(url, {
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        logger: false,
      });
    }
    return this.transporter;
  }
}

/** `awa@example.td` -> `a***@example.td` */
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}
