import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './index.js';

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe: the routes and
// bodies of SPEC-020-03 to SPEC-020-06 ("Contrats API et données").

function recordingApi() {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname.replace('/v1', ''),
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  }) as unknown as typeof fetch;
  const api = createApiClient({
    baseUrl: 'http://api.test/v1',
    getAccessToken: () => null,
    fetchImpl,
  });
  return { api, calls };
}

describe('FEAT-020 — account routes of the SDK', () => {
  it('registration: request, verify, resend', async () => {
    const { api, calls } = recordingApi();
    const form = { fullName: 'Awa', phone: '66 12 34 56', email: 'awa@example.td', password: 'p' };
    await api.auth.register(form);
    await api.auth.verifyRegistration('r-1', '123456');
    await api.auth.resendRegistration('r-1');
    expect(calls).toEqual([
      { method: 'POST', path: '/auth/register', body: form },
      {
        method: 'POST',
        path: '/auth/register/verify',
        body: { registrationId: 'r-1', code: '123456' },
      },
      { method: 'POST', path: '/auth/register/resend', body: { registrationId: 'r-1' } },
    ]);
  });

  it('password login sends the device token only when there is one', async () => {
    const { api, calls } = recordingApi();
    await api.auth.passwordLogin({ email: 'awa@example.td', password: 'p', deviceToken: null });
    await api.auth.passwordLogin({ email: 'awa@example.td', password: 'p', deviceToken: 'dev-1' });
    expect(calls.map((c) => c.body)).toEqual([
      { email: 'awa@example.td', password: 'p' },
      { email: 'awa@example.td', password: 'p', deviceToken: 'dev-1' },
    ]);
  });

  it('new device code, forgotten password, code-only login', async () => {
    const { api, calls } = recordingApi();
    await api.auth.sendLoginCode('c-1', 'sms');
    await api.auth.verifyLoginCode({
      challengeId: 'c-1',
      channel: 'email',
      code: '123456',
      rememberDevice: true,
    });
    await api.auth.forgotPassword('awa@example.td');
    await api.auth.resetPassword({ email: 'awa@example.td', code: '123456', password: 'n' });
    await api.auth.requestEmailCode('awa@example.td');
    await api.auth.verifyEmailCode('awa@example.td', '123456');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /auth/password/challenge/send',
      'POST /auth/password/challenge/verify',
      'POST /auth/password/forgot',
      'POST /auth/password/reset',
      'POST /auth/email/request',
      'POST /auth/email/verify',
    ]);
    expect(calls[0]?.body).toEqual({ challengeId: 'c-1', channel: 'sms' });
  });

  it('« Mon profil »: change the password (PUT), confirm the number', async () => {
    const { api, calls } = recordingApi();
    await api.auth.changePassword({ currentPassword: 'a', newPassword: 'b' });
    await api.auth.requestPhoneCode();
    await api.auth.verifyPhone('whatsapp', '123456');
    expect(calls).toEqual([
      { method: 'PUT', path: '/me/password', body: { currentPassword: 'a', newPassword: 'b' } },
      { method: 'POST', path: '/me/phone/request', body: { channel: 'sms' } },
      { method: 'POST', path: '/me/phone/verify', body: { channel: 'whatsapp', code: '123456' } },
    ]);
  });
});
