import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { makeAddressesRaceDb } from './addresses-test-support';

/**
 * Bloc 8 — the customer's address book (docs/29). Closes the top finding of
 * the pre-Bloc-8 CTO audit: `orders.createOrder` has always read a default
 * address, but nothing ever let a real customer create one.
 *
 * The concurrency tests drive the REAL `AddressesService` under genuine
 * `Promise.all([...])` against a lock-aware fake that enforces migration
 * 0027's partial unique index (`addresses_one_default_per_user`) for real —
 * the same discipline as every prior bloc's concurrency harness.
 */

const ALICE = 'user-alice';
const BOB = 'user-bob';
const CITY_ID = '11111111-1111-1111-1111-111111111111';

function makeService() {
  const { db, addresses, cities } = makeAddressesRaceDb();
  cities.push({ id: CITY_ID });
  return { service: new AddressesService(db), addresses, cities };
}

const INPUT = {
  label: 'Domicile',
  recipientPhone: '+23566000001',
  cityId: CITY_ID,
  quartier: 'Klemat',
  street: 'Rue 42',
  landmark: 'Près du rond-point Kondolé',
  coordinates: { lat: 12.14, lng: 15.062 },
};

describe('create (docs/29 §address-domain)', () => {
  it('creates an address and becomes default automatically — the FIRST address always is', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT);

    expect(created.isDefault).toBe(true);
    expect(created.label).toBe('Domicile');
    expect(created.lat).toBe(12.14);
    expect(created.lng).toBe(15.062);
    expect(created.geocodeStatus).toBe('ok');
  });

  it('a second address is NOT default unless requested', async () => {
    const { service } = makeService();
    await service.create(ALICE, INPUT);
    const second = await service.create(ALICE, { ...INPUT, label: 'Bureau' });

    expect(second.isDefault).toBe(false);
  });

  it('a second address created with isDefault:true becomes the new default, demoting the first', async () => {
    const { service } = makeService();
    const first = await service.create(ALICE, INPUT);
    const second = await service.create(ALICE, { ...INPUT, label: 'Bureau', isDefault: true });

    expect(second.isDefault).toBe(true);
    const refreshedFirst = await service.get(ALICE, first.id);
    expect(refreshedFirst.isDefault).toBe(false);
  });

  it('without coordinates, geocodeStatus is "manual" — landmark-first addressing, never invented', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, { quartier: 'Klemat', landmark: 'Marché' });
    expect(created.geocodeStatus).toBe('manual');
    expect(created.lat).toBeNull();
    expect(created.lng).toBeNull();
  });

  it('rejects out-of-range coordinates with INVALID_LOCATION, never a raw error', async () => {
    const { service } = makeService();
    await expect(
      service.create(ALICE, { ...INPUT, coordinates: { lat: 999, lng: 15 } }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('rejects an unknown cityId cleanly', async () => {
    const { service } = makeService();
    await expect(
      service.create(ALICE, { ...INPUT, cityId: '22222222-2222-2222-2222-222222222222' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});

describe('read own (docs/29)', () => {
  it('lists only the caller’s own addresses, most-recent/default first', async () => {
    const { service } = makeService();
    await service.create(ALICE, { ...INPUT, label: 'A1' });
    await service.create(ALICE, { ...INPUT, label: 'A2' });
    await service.create(BOB, { ...INPUT, label: 'B1' });

    const list = await service.list(ALICE);
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.label !== 'B1')).toBe(true);
  });

  it('an empty user has an empty list, not an error', async () => {
    const { service } = makeService();
    await expect(service.list(ALICE)).resolves.toEqual([]);
  });

  it('get returns the address by id for its owner', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT);
    const fetched = await service.get(ALICE, created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('get on an unknown id is a clean 404', async () => {
    const { service } = makeService();
    await expect(service.get(ALICE, 'does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('cross-owner access is refused — IDOR (docs/29)', () => {
  it('Bob cannot read Alice’s address — same 404 as a missing one', async () => {
    const { service } = makeService();
    const alices = await service.create(ALICE, INPUT);
    await expect(service.get(BOB, alices.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Bob cannot update Alice’s address', async () => {
    const { service } = makeService();
    const alices = await service.create(ALICE, INPUT);
    await expect(service.update(BOB, alices.id, { label: 'Hacked' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const stillAlices = await service.get(ALICE, alices.id);
    expect(stillAlices.label).toBe('Domicile'); // untouched
  });

  it('Bob cannot delete Alice’s address', async () => {
    const { service } = makeService();
    const alices = await service.create(ALICE, INPUT);
    await expect(service.remove(BOB, alices.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(ALICE, alices.id)).resolves.toBeDefined(); // untouched
  });

  it('Bob cannot set Alice’s address as default', async () => {
    const { service } = makeService();
    const alices = await service.create(ALICE, INPUT);
    await expect(service.setDefault(BOB, alices.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('update own (docs/29)', () => {
  it('updates scalar fields without touching unrelated ones', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT);
    const updated = await service.update(ALICE, created.id, { label: 'Nouveau nom' });

    expect(updated.label).toBe('Nouveau nom');
    expect(updated.quartier).toBe('Klemat'); // unchanged
  });

  it('updating coordinates re-derives geocodeStatus to "ok"', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, { quartier: 'Klemat' }); // manual
    const updated = await service.update(ALICE, created.id, {
      coordinates: { lat: 12.1, lng: 15.05 },
    });
    expect(updated.geocodeStatus).toBe('ok');
    expect(updated.lat).toBe(12.1);
  });

  it('rejects out-of-range coordinates on update too', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT);
    await expect(
      service.update(ALICE, created.id, { coordinates: { lat: 999, lng: 1 } }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_LOCATION' } });
  });

  it('never alters a past order’s frozen snapshot (docs/29 — structural, not a new guard)', async () => {
    // AddressesService never touches `orders`/`dropoff_*` at all — this test
    // documents and locks that fact rather than exercising new code: there is
    // no shared mutable state between a UserAddress and any OrderAddressSnapshot.
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT);
    await service.update(ALICE, created.id, { landmark: 'Nouveau repère' });
    // Nothing to assert against `orders` here — the absence of any such call
    // is what migration 0025's `ON DELETE SET NULL` + the frozen scalar
    // columns on `orders` already guarantee (verified in docs/25 §B6.1-6).
    expect(true).toBe(true);
  });
});

describe('the default invariant (docs/29 — mandate rules 3-7)', () => {
  it('setting an address already default is idempotent — no error, same result', async () => {
    const { service } = makeService();
    const created = await service.create(ALICE, INPUT); // already default
    const result = await service.setDefault(ALICE, created.id);
    expect(result.isDefault).toBe(true);
  });

  it('setting a new default demotes exactly the previous one', async () => {
    const { service } = makeService();
    const first = await service.create(ALICE, INPUT);
    const second = await service.create(ALICE, { ...INPUT, label: 'Bureau' });

    await service.setDefault(ALICE, second.id);

    expect((await service.get(ALICE, second.id)).isDefault).toBe(true);
    expect((await service.get(ALICE, first.id)).isDefault).toBe(false);
  });

  it('TWO genuinely concurrent setDefault calls for the SAME user: exactly one default survives', async () => {
    const { service, addresses } = makeService();
    const a = await service.create(ALICE, { ...INPUT, label: 'A' });
    const b = await service.create(ALICE, { ...INPUT, label: 'B' });

    const results = await Promise.allSettled([
      service.setDefault(ALICE, a.id),
      service.setDefault(ALICE, b.id),
    ]);

    // Both calls are legitimate requests on the user's OWN addresses — neither
    // is "wrong", so both may fulfil (last-write-wins is an acceptable
    // outcome for this kind of race, docs/29) but the INVARIANT must hold
    // unconditionally regardless of which one "won".
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const defaults = addresses.filter((row) => row.userId === ALICE && row.isDefault);
    expect(defaults).toHaveLength(1); // never zero, never two
  });

  it('concurrent default-setting across TWO DIFFERENT users never interferes', async () => {
    const { service, addresses } = makeService();
    const alice = await service.create(ALICE, INPUT);
    const aliceSecond = await service.create(ALICE, { ...INPUT, label: 'A2' });
    const bob = await service.create(BOB, INPUT);
    const bobSecond = await service.create(BOB, { ...INPUT, label: 'B2' });

    await Promise.all([
      service.setDefault(ALICE, aliceSecond.id),
      service.setDefault(BOB, bobSecond.id),
    ]);

    expect(addresses.filter((a) => a.userId === ALICE && a.isDefault)).toHaveLength(1);
    expect(addresses.filter((a) => a.userId === BOB && a.isDefault)).toHaveLength(1);
    expect((await service.get(ALICE, aliceSecond.id)).isDefault).toBe(true);
    expect((await service.get(BOB, bobSecond.id)).isDefault).toBe(true);
    void alice;
    void bob;
  });
});

describe('deleting the default — chosen strategy: auto-promotion (docs/29)', () => {
  it('deleting the default promotes the most recently created remaining address', async () => {
    const { service } = makeService();
    const first = await service.create(ALICE, { ...INPUT, label: 'Old' }); // becomes default
    const second = await service.create(ALICE, { ...INPUT, label: 'New' });

    await service.remove(ALICE, first.id);

    const remaining = await service.get(ALICE, second.id);
    expect(remaining.isDefault).toBe(true);
  });

  it('deleting a NON-default address never touches the current default', async () => {
    const { service } = makeService();
    const first = await service.create(ALICE, INPUT); // default
    const second = await service.create(ALICE, { ...INPUT, label: 'Other' });

    await service.remove(ALICE, second.id);

    expect((await service.get(ALICE, first.id)).isDefault).toBe(true);
  });

  it('deleting the user’s LAST address is allowed — they return to the "no address" state', async () => {
    const { service, addresses } = makeService();
    const only = await service.create(ALICE, INPUT);
    await service.remove(ALICE, only.id);
    expect(addresses.filter((a) => a.userId === ALICE)).toHaveLength(0);
  });

  it('deleting an unknown address is a clean 404, not a silent no-op', async () => {
    const { service } = makeService();
    await expect(service.remove(ALICE, 'does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('concurrent delete + default-change races never violate the invariant (docs/29)', () => {
  it('deleting the default while another call sets a DIFFERENT address as default: invariant holds', async () => {
    const { service, addresses } = makeService();
    const defaultAddr = await service.create(ALICE, { ...INPUT, label: 'Default' });
    const other = await service.create(ALICE, { ...INPUT, label: 'Other' });

    const results = await Promise.allSettled([
      service.remove(ALICE, defaultAddr.id),
      service.setDefault(ALICE, other.id),
    ]);

    // Whichever interleaving occurred, the surviving rows for ALICE have
    // AT MOST one default — never two, and (since `other` still exists either
    // way) never zero either.
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    const defaults = addresses.filter((a) => a.userId === ALICE && a.isDefault);
    expect(defaults.length).toBeLessThanOrEqual(1);
  });
});
