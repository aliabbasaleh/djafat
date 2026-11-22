import { describe, expect, it } from 'vitest';
import { smtpSender, smtpTransportOptions, type SmtpSettings } from './smtp-options';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-01).

const none: SmtpSettings = {
  SMTP_URL: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: 465,
  SMTP_USER: undefined,
  SMTP_PASSWORD: undefined,
  EMAIL_FROM: undefined,
};

describe('SPEC-020-01 — SMTP transport options', () => {
  // SPEC-020-01-SC01
  it('SPEC-020-01-SC01 — Gmail: smtp.gmail.com:465 in TLS, the address, the app password without spaces, DJAFAT as sender', () => {
    const gmail: SmtpSettings = {
      ...none,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'djafat@gmail.com',
      SMTP_PASSWORD: 'abcd efgh ijkl mnop',
    };
    expect(smtpTransportOptions(gmail)).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'djafat@gmail.com', pass: 'abcdefghijklmnop' },
    });
    expect(smtpSender(gmail)).toBe('DJAFAT <djafat@gmail.com>');
  });

  it('SPEC-020-01-SC01 — another provider: spaces in its password are kept, STARTTLS on 587, EMAIL_FROM wins', () => {
    const other: SmtpSettings = {
      ...none,
      SMTP_HOST: 'smtp-relay.example.td',
      SMTP_PORT: 587,
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'two words',
      EMAIL_FROM: 'DJAFAT <no-reply@djafat.td>',
    };
    expect(smtpTransportOptions(other)).toMatchObject({
      host: 'smtp-relay.example.td',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'two words' },
    });
    expect(smtpSender(other)).toBe('DJAFAT <no-reply@djafat.td>');
  });

  // SPEC-020-01-SC03
  it('SPEC-020-01-SC03 — SMTP_URL is used as before, and wins over the separate fields', () => {
    const url = 'smtps://u:p@smtp.example.td:465';
    const options = smtpTransportOptions({
      ...none,
      SMTP_URL: url,
      SMTP_HOST: 'smtp.gmail.com',
      EMAIL_FROM: 'DJAFAT <no-reply@djafat.td>',
    });
    expect(options).toMatchObject({ url });
    expect(options.host).toBeUndefined();
    expect(() => smtpTransportOptions(none)).toThrowError(/SMTP_URL or SMTP_HOST/);
  });
});
