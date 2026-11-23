import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../../../common/redis/redis.service';
import { accountNoticeMessage } from './account-notice-text';
import { MockAccountNoticeProvider, mockAccountNoticeKey } from './mock-account-notice.provider';
import { SmtpAccountNoticeProvider } from './smtp-account-notice.provider';
import { closeSmtpSinks, configFake, decodedBody, smtpSink } from './smtp-test-support';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-01 R6).

afterEach(async () => {
  await closeSmtpSinks();
  vi.restoreAllMocks();
});

const AT = new Date('2026-11-21T13:05:00Z'); // 14:05 in N'Djamena (UTC+1)

describe('SPEC-020-01 — account notices without a code', () => {
  // SPEC-020-01-SC05
  it('SPEC-020-01-SC05 — in development the last notice of an address is readable in Redis', async () => {
    const set = vi.fn(async () => 'OK');
    const redis = { client: { set } } as unknown as RedisService;
    const mock = new MockAccountNoticeProvider(redis, configFake({ NODE_ENV: 'development' }));

    await mock.send({ kind: 'already_registered', to: 'awa@example.td' });
    expect(set).toHaveBeenLastCalledWith(
      mockAccountNoticeKey('awa@example.td'),
      JSON.stringify({
        kind: 'already_registered',
        subject: 'Vous avez déjà un compte DJAFAT',
      }),
      'EX',
      600,
    );

    await mock.send({ kind: 'password_changed', to: 'awa@example.td', at: AT });
    expect(set).toHaveBeenLastCalledWith(
      'mail:mock:awa@example.td',
      JSON.stringify({
        kind: 'password_changed',
        subject: 'Votre mot de passe DJAFAT a été modifié',
      }),
      'EX',
      600,
    );
  });

  // SPEC-020-01-SC05
  it('SPEC-020-01-SC05 — in production the mock sends nothing and does not fail', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const set = vi.fn();
    const redis = { client: { set } } as unknown as RedisService;
    const mock = new MockAccountNoticeProvider(redis, configFake({ NODE_ENV: 'production' }));
    await expect(mock.send({ kind: 'already_registered', to: 'awa@example.td' })).resolves.toBe(
      'unavailable',
    );
    expect(set).not.toHaveBeenCalled();
  });

  // SPEC-020-01-SC05
  it('SPEC-020-01-SC05 — by SMTP the notice arrives; a server that is down is logged, never thrown', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const sink = await smtpSink();
    const outcome = await new SmtpAccountNoticeProvider(
      configFake({ SMTP_URL: sink.url, EMAIL_FROM: 'DJAFAT <no-reply@djafat.test>' }),
    ).send({ kind: 'password_changed', to: 'awa@example.td', at: AT });
    expect(outcome).toBe('sent');
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toMatchObject({ to: ['awa@example.td'] });
    const body = decodedBody(sink.received[0]?.raw ?? '');
    expect(body).toContain('a été modifié le 21 novembre 2026');
    expect(body).toContain('14:05');

    await expect(
      new SmtpAccountNoticeProvider(
        configFake({ SMTP_URL: 'smtp://127.0.0.1:1', EMAIL_FROM: 'DJAFAT <a@b.td>' }),
      ).send({ kind: 'already_registered', to: 'awa@example.td' }),
    ).resolves.toBe('failed');
    expect(logs.join('\n')).not.toContain('awa@example.td');
  });

  it('SPEC-020-01-SC05 — the "already registered" notice points to login and to "Mot de passe oublié ?"', () => {
    const { text } = accountNoticeMessage({ kind: 'already_registered', to: 'awa@example.td' });
    expect(text).toContain('« Se connecter »');
    expect(text).toContain('« Mot de passe oublié ? »');
  });

  // SPEC-020-12-SC04
  it('SPEC-020-12-SC04 — the "e-mail changed" alert names the masked new address and what to do', () => {
    const { subject, text } = accountNoticeMessage({
      kind: 'email_changed',
      to: 'awa@example.td',
      newAddress: 'a***@gmail.com',
      at: new Date('2026-11-21T13:05:00Z'),
    });
    expect(subject).toContain('a été changée');
    expect(text).toContain('a***@gmail.com');
    expect(text).toContain('le 21 novembre 2026');
    expect(text).toContain('contactez DJAFAT');
  });
});

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-07 R5).
describe('SPEC-022-07 — the e-mails of a decision', () => {
  it('SPEC-022-07-SC03 — a refused courier reads the reason and how to send again', () => {
    const { subject, text } = accountNoticeMessage({
      kind: 'application_rejected',
      to: 'abakar@example.td',
      applicant: { type: 'courier' },
      reason: 'La photo du permis est floue.',
    });
    expect(subject).toBe('Votre demande de livreur DJAFAT est refusée');
    expect(text).toContain('Motif : La photo du permis est floue.');
    expect(text).toContain('« Envoyer pour validation »');
  });

  it('SPEC-022-07-SC03 — an approved courier is told to go online', () => {
    const { subject, text } = accountNoticeMessage({
      kind: 'application_approved',
      to: 'abakar@example.td',
      applicant: { type: 'courier' },
    });
    expect(subject).toBe('Votre compte livreur DJAFAT est validé');
    expect(text).toContain('« En ligne »');
  });

  it('SPEC-022-07-SC02 — « Votre restaurant est validé », named, now visible to customers', () => {
    const { subject, text } = accountNoticeMessage({
      kind: 'application_approved',
      to: 'fatime@example.td',
      applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
    });
    expect(subject).toBe('Votre restaurant « Chez Fatimé » est validé');
    expect(text).toContain('visible des clients');
  });

  it('a refused restaurant reads the reason and where to correct it', () => {
    const { subject, text } = accountNoticeMessage({
      kind: 'application_rejected',
      to: 'fatime@example.td',
      applicant: { type: 'restaurant', restaurantName: 'Chez Fatimé' },
      reason: 'Le numéro RCCM ne correspond pas à la photo.',
    });
    expect(subject).toBe('Le dossier de « Chez Fatimé » est refusé');
    expect(text).toContain('Motif : Le numéro RCCM ne correspond pas à la photo.');
    expect(text).toContain('console restaurant');
  });
});
