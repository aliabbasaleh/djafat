import { describe, expect, it, vi } from 'vitest';
import {
  changeTopicText,
  mobileMoneyErrors,
  mobileMoneyRequest,
  pendingChangeOf,
  restaurantLocationErrors,
  restaurantLocationRequest,
  restaurantPapersErrors,
  restaurantPapersRequest,
  mobileMoneyText,
  photoContentType,
  rejectionReasonError,
  restaurantStatusLine,
  restaurantSubmitState,
} from './applications.js';
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

// FEAT-022 part 3 — SPEC-022-05, SPEC-022-07 R6.
describe('FEAT-022 — the restaurant’s four steps and the changes in the SDK', () => {
  it('SPEC-022-05 — the owner reads, saves step 1 and step 4, sends a paper and a logo, and submits', async () => {
    const { api, calls } = client();
    const jpeg = new Blob([Uint8Array.of(0xff, 0xd8, 0xff)], { type: 'image/jpeg' });

    await api.restaurant.application.get();
    await api.restaurant.application.updateLocation({
      lat: 12.1067,
      lng: 15.0444,
      addressText: 'Avenue Charles de Gaulle',
    });
    await api.restaurant.application.updatePapers({ registryNumber: 'TD-NDJ-2026-B-1234' });
    await api.restaurant.application.uploadPaper('registry', jpeg);
    await api.restaurant.application.paperLink('owner_id');
    await api.restaurant.application.uploadPhoto('logo', jpeg);
    await api.restaurant.application.submit();

    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/v1', '')}`)).toEqual([
      'GET /restaurants/me/application',
      'PUT /restaurants/me/application/location',
      'PUT /restaurants/me/application/papers',
      'POST /restaurants/me/application/files/registry',
      'GET /restaurants/me/application/files/owner_id',
      'POST /restaurants/me/photos/logo',
      'POST /restaurants/me/application/submit',
    ]);
    expect(calls[3]).toMatchObject({ contentType: 'image/jpeg', body: jpeg });
  });

  it('SPEC-022-07 R2, R6 — the admin opens a restaurant, a paper, a change’s photo, and decides the change', async () => {
    const { api, calls } = client();

    await api.admin.applications.getRestaurant('r-1');
    await api.admin.applications.restaurantPaperLink('r-1', 'registry');
    await api.admin.applications.approveRestaurant('r-1');
    await api.admin.applications.rejectRestaurant('r-1', 'La photo du RCCM est illisible.');
    await api.admin.applications.changePhotoLink('restaurant', 'r-1', 'c-1');
    await api.admin.applications.approveChange('courier', 'u-1', 'c-2');
    await api.admin.applications.rejectChange('courier', 'u-1', 'c-3', 'Numéro au nom d’un autre.');

    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/v1', '')}`)).toEqual([
      'GET /admin/applications/restaurant/r-1',
      'GET /admin/applications/restaurant/r-1/files/registry',
      'POST /admin/applications/restaurant/r-1/approve',
      'POST /admin/applications/restaurant/r-1/reject',
      'GET /admin/applications/restaurant/r-1/changes/c-1/file',
      'POST /admin/applications/courier/u-1/changes/c-2/approve',
      'POST /admin/applications/courier/u-1/changes/c-3/reject',
    ]);
  });

  it('SPEC-022-09 R3, R4 — the admin lists, adds, renames or disables a neighbourhood, and reads the names typed', async () => {
    const { api, calls } = client();

    await api.admin.neighbourhoods.list();
    await api.admin.neighbourhoods.typed();
    await api.admin.neighbourhoods.create('Gassi Est');
    await api.admin.neighbourhoods.update('n-1', { active: false });

    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/v1', '')}`)).toEqual([
      'GET /admin/neighbourhoods',
      'GET /admin/neighbourhoods/typed',
      'POST /admin/neighbourhoods',
      'PATCH /admin/neighbourhoods/n-1',
    ]);
    expect(calls[2]?.body).toBe('{"name":"Gassi Est"}');
    expect(calls[3]?.body).toBe('{"active":false}');
  });

  it('SPEC-022-05 R3, « UI » — « Envoyer pour validation » says what is left; sent or validated, it is gone', () => {
    const steps = (done: boolean[]) =>
      (['location', 'hours_menu', 'photos', 'papers'] as const).map((step, i) => ({
        step,
        done: done[i]!,
      }));

    expect(
      restaurantSubmitState({ status: 'to_complete', steps: steps([true, false, false, true]) }),
    ).toEqual({ canSubmit: false, reason: 'Il reste : Horaires et menu, Logo et photos' });
    expect(
      restaurantSubmitState({ status: 'rejected', steps: steps([true, true, true, true]) }),
    ).toEqual({ canSubmit: true, reason: null });
    expect(
      restaurantSubmitState({ status: 'pending_review', steps: steps([true, true, true, true]) })
        .canSubmit,
    ).toBe(false);
  });

  it('SPEC-022-05 R4 — the three states after sending', () => {
    expect(restaurantStatusLine({ status: 'to_complete', rejectionReason: null })).toBeNull();
    expect(restaurantStatusLine({ status: 'pending_review', rejectionReason: null })).toBe(
      '⏳ En cours de vérification par DJAFAT — vous recevrez un e-mail.',
    );
    expect(
      restaurantStatusLine({
        status: 'rejected',
        rejectionReason: 'La photo du RCCM est illisible.',
      }),
    ).toBe('❌ Refusé : « La photo du RCCM est illisible. » — corrigez, puis renvoyez.');
    expect(restaurantStatusLine({ status: 'approved', rejectionReason: null })).toBe(
      '✅ Validé : votre restaurant est visible des clients.',
    );
  });

  it('SPEC-022-07 R6 — a change is named; a number shows its provider', () => {
    expect(changeTopicText('mobile_money')).toBe('Numéro Mobile Money');
    expect(changeTopicText('owner_id')).toBe("Pièce d'identité du responsable");
    expect(changeTopicText('something_new')).toBe('Changement');
    expect(mobileMoneyText({ provider: 'moov', number: '+23599000001' })).toBe(
      'Moov Money +23599000001',
    );
  });
});

describe('FEAT-022 — the forms of steps 1 and 4 and of a new Mobile Money number', () => {
  it('SPEC-022-05 « UI » — step 1: the point is required even with the address typed', () => {
    expect(
      restaurantLocationErrors({ point: null, addressText: 'Avenue Mobutu', landmark: '' }),
    ).toEqual({
      point: 'Placez le point de votre restaurant : touchez la carte, ou « Utiliser ma position ».',
    });
    expect(
      restaurantLocationErrors({
        point: { lat: 12.1, lng: 15.05 },
        addressText: ' a ',
        landmark: '',
      }),
    ).toEqual({ addressText: "Indiquez l'adresse." });
    expect(
      restaurantLocationRequest({
        point: { lat: 12.1, lng: 15.05 },
        addressText: ' Avenue Mobutu ',
        landmark: '  ',
      }),
    ).toEqual({ lat: 12.1, lng: 15.05, addressText: 'Avenue Mobutu' });
  });

  it('SPEC-022-05 R1, SPEC-024-02 R4 — step 4: the RCCM or NIF number, the operator and a Chad mobile', () => {
    expect(
      restaurantPapersErrors({ registryNumber: '', provider: '', number: '+33 6 12 34 56 78' }),
    ).toEqual({
      registryNumber: 'Indiquez le numéro RCCM ou NIF.',
      provider: 'Choisissez Airtel Money ou Moov Money.',
      number: expect.stringContaining('+235'),
    });
    expect(
      restaurantPapersRequest({
        registryNumber: ' TD-NDJ-2026-B-1234 ',
        provider: 'airtel',
        number: '66 00 00 02',
      }),
    ).toEqual({
      registryNumber: 'TD-NDJ-2026-B-1234',
      mobileMoney: { provider: 'airtel', number: '+23566000002' },
    });
    expect(mobileMoneyErrors({ provider: 'moov', number: '99 00 00 03' })).toEqual({});
    expect(mobileMoneyRequest({ provider: 'moov', number: '99 00 00 03' })).toEqual({
      provider: 'moov',
      number: '+23599000003',
    });
  });

  it('SPEC-022-07 R6 — the waiting change of a topic', () => {
    const change = {
      id: 'c-1',
      kind: 'mobile_money' as const,
      topic: 'mobile_money',
      createdAt: '2026-11-24T08:00:00.000Z',
    };
    expect(pendingChangeOf({ pendingChanges: [change] }, 'mobile_money')).toBe(change);
    expect(pendingChangeOf({ pendingChanges: [change] }, 'registry')).toBeNull();
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
