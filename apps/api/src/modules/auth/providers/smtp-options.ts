import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { ApiEnv } from '@djafat/config';
import type { AppConfigService } from '../../../common/config/config.service';

/**
 * The SMTP server every account email goes through (FEAT-007, FEAT-020
 * SPEC-020-01): either `SMTP_URL`, or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
 * `SMTP_PASSWORD` — the official Gmail account with an app password.
 * Shared by the code transport and the notices.
 */
export type SmtpSettings = Pick<
  ApiEnv,
  'SMTP_URL' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'EMAIL_FROM'
>;

const GMAIL_HOST = 'smtp.gmail.com';
const IMPLICIT_TLS_PORT = 465;

/**
 * Timeouts are TRANSPORT options (connection): they go with the server, in
 * the first argument of `createTransport`; its second argument is per-message
 * defaults and would silently ignore them.
 */
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };

export function smtpSettingsFrom(config: AppConfigService): SmtpSettings {
  return {
    SMTP_URL: config.get('SMTP_URL'),
    SMTP_HOST: config.get('SMTP_HOST'),
    SMTP_PORT: config.get('SMTP_PORT'),
    SMTP_USER: config.get('SMTP_USER'),
    SMTP_PASSWORD: config.get('SMTP_PASSWORD'),
    EMAIL_FROM: config.get('EMAIL_FROM'),
  };
}

/** What `createTransport` receives. `SMTP_URL` wins when both forms are given (SPEC-020-01 R1). */
export function smtpTransportOptions(settings: SmtpSettings): SMTPTransport.Options {
  if (settings.SMTP_URL) return { url: settings.SMTP_URL, ...TIMEOUTS, logger: false };
  const host = settings.SMTP_HOST;
  if (!host) throw new Error('SMTP_URL or SMTP_HOST is not configured');
  const port = settings.SMTP_PORT ?? IMPLICIT_TLS_PORT;
  // R3: Google shows an app password as four groups of four letters.
  const pass =
    host.toLowerCase() === GMAIL_HOST
      ? (settings.SMTP_PASSWORD ?? '').replace(/\s+/g, '')
      : settings.SMTP_PASSWORD;
  return {
    host,
    port,
    secure: port === IMPLICIT_TLS_PORT, // R2: TLS from the start on 465, STARTTLS otherwise
    ...(settings.SMTP_USER ? { auth: { user: settings.SMTP_USER, pass } } : {}),
    ...TIMEOUTS,
    logger: false,
  };
}

/** R4: `EMAIL_FROM`, or `DJAFAT <SMTP_USER>` (Gmail rewrites any sender that is not the account). */
export function smtpSender(settings: SmtpSettings): string {
  if (settings.EMAIL_FROM) return settings.EMAIL_FROM;
  return settings.SMTP_USER ? `DJAFAT <${settings.SMTP_USER}>` : 'DJAFAT';
}
