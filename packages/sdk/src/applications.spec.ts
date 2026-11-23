import { describe, expect, it, vi } from 'vitest';
import { photoContentType, rejectionReasonError } from './applications.js';
import { createApiClient } from './index.js';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-04, 06, 07).

interface Call {
  method: string;
  url: string;
  contentType: string | null;
  body: unknown;
}

function client() {
  const calls: Call[] = [];
  const api = createApiClient({
    baseUrl: 'http://api.test/v1',
    fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input),
        contentType: headers.get('content-type'),
        body: init?.body,
      });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  });
  return { api, calls };
}

describe('FEAT-022 — the courier’s application in the SDK', () => {
  it('SPEC-022-04-SC03 — a photo goes as the body itself, with its own type; an unknown type as octet-stream', async () => {
    const { api, calls } = client();
    const jpeg = new Blob([Uint8Array.of(0xff, 0xd8, 0xff)], { type: 'image/jpeg' });
    const heic = new Blob([Uint8Array.of(0, 0, 0)], { type: 'image/heic' });

    await api.courier.application.uploadPhoto('driving_licence', jpeg);
    await api.courier.application.uploadPhoto('face', heic);

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://api.test/v1/couriers/me/application/files/driving_licence',
      contentType: 'image/jpeg',
      body: jpeg,
    });
    expect(calls[1]).toMatchObject({ contentType: 'application/octet-stream', body: heic });
  });

  it('SPEC-022-06 — reads, saves one part, links a photo and sends the application', async () => {
    const { api, calls } = client();

    await api.courier.application.get();
    await api.courier.application.update({ vehicle: 'velo' });
    await api.courier.application.photoLink('id_card');
    await api.courier.application.submit();

    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/v1', '')}`)).toEqual([
      'GET /couriers/me/application',
      'PUT /couriers/me/application',
      'GET /couriers/me/application/files/id_card',
      'POST /couriers/me/application/submit',
    ]);
    expect(calls[1]).toMatchObject({ contentType: 'application/json', body: '{"vehicle":"velo"}' });
  });

  it('SPEC-022-07 — the admin lists a tab, opens a courier, a photo, and decides with a reason', async () => {
    const { api, calls } = client();

    await api.admin.applications.list('courier');
    await api.admin.applications.getCourier('u-1');
    await api.admin.applications.courierPhotoLink('u-1', 'face');
    await api.admin.applications.approveCourier('u-1');
    await api.admin.applications.rejectCourier('u-1', 'La photo du permis est floue.');

    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/v1', '')}`)).toEqual([
      'GET /admin/applications?type=courier',
      'GET /admin/applications/courier/u-1',
      'GET /admin/applications/courier/u-1/files/face',
      'POST /admin/applications/courier/u-1/approve',
      'POST /admin/applications/courier/u-1/reject',
    ]);
    expect(calls[4]?.body).toBe('{"reason":"La photo du permis est floue."}');
  });
});

describe('photoContentType', () => {
  it('keeps the three photo types, fixes image/jpg, and sends anything else as octet-stream', () => {
    expect(photoContentType('image/png')).toBe('image/png');
    expect(photoContentType('IMAGE/WEBP')).toBe('image/webp');
    expect(photoContentType('image/jpg')).toBe('image/jpeg');
    expect(photoContentType('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(photoContentType('application/pdf')).toBe('application/octet-stream');
    expect(photoContentType(undefined)).toBe('application/octet-stream');
  });
});

describe('rejectionReasonError (SPEC-022-07 R4)', () => {
  it('SPEC-022-07-SC03 — refuses an empty or too short reason, accepts « La photo du permis est floue. »', () => {
    expect(rejectionReasonError('   ')).toBe('Écrivez le motif du refus (10 caractères au moins).');
    expect(rejectionReasonError('La photo du permis est floue.')).toBeNull();
    expect(rejectionReasonError('a'.repeat(501))).toBe(
      'Le motif ne doit pas dépasser 500 caractères.',
    );
  });
});
