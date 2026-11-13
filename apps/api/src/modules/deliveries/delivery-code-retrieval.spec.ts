import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AccessActor } from '../../common/authz/order-access';
import {
  CUSTOMER_ID,
  buildDeliveriesServices,
  makeDeliveriesRaceDb,
  seedAssignedOffer,
  seedDeliveryCode,
} from './deliveries-test-support';

/**
 * The pilot's P0 n°1 (docs/36): `issueDeliveryCode` generated a code, hashed
 * it, and emitted the raw value on an in-process event with ZERO listeners —
 * so no real customer could ever learn the code a real courier must ask them
 * for, and `confirmDelivered` could only ever answer INVALID_PROOF. The code
 * is now also stored ENCRYPTED (never plaintext) so its owner can read it
 * back, and `getDeliveryCodeFor` is the only way out of the database.
 *
 * What these tests pin, in priority order (security → data → journey):
 *   1. only the owning customer can read it;
 *   2. the ASSIGNED COURIER cannot — the whole point of a proof code;
 *   3. every refusal is the same 404 as an absent delivery;
 *   4. the round-trip actually returns the code the courier will validate.
 */

const COURIER = 'courier-A';

function actor(userId: string, roles: readonly string[] = ['customer']): AccessActor {
  return { userId, roles, permissions: [] } as unknown as AccessActor;
}

function setup(code = '4242', codeOverrides: Parameters<typeof seedDeliveryCode>[3] = {}) {
  const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
  const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
  const proof = seedDeliveryCode(proofs, delivery.id, code, codeOverrides);
  const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
  return { service, delivery, proof, proofs };
}

describe('getDeliveryCodeFor — who may read a delivery code (pilot P0, docs/36)', () => {
  it('returns the real code to the owning customer, decrypted from what issuance stored', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    // Issue through the PRODUCTION path, so the encrypted `reference` this
    // reads back is the one `issueDeliveryCode` actually writes — not a
    // fixture that could drift from it.
    const issued = await service.issueDeliveryCode(delivery.id, COURIER);

    const read = await service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id);
    expect(read.code).toBe(issued);
    expect(read.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('never stores the code in plaintext — the stored reference is not the code', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const issued = await service.issueDeliveryCode(delivery.id, COURIER);
    const stored = proofs.find((p) => p.deliveryId === delivery.id)!;

    expect(stored.reference).toBeTruthy();
    expect(stored.reference).not.toBe(issued);
    expect(stored.reference).not.toContain(issued);
    expect(stored.valueHash).not.toContain(issued);
    // `iv.authTag.ciphertext`, all base64 — the shape `decryptAtRest` expects.
    expect(stored.reference!.split('.')).toHaveLength(3);
  });

  it('refuses the ASSIGNED COURIER with the same 404 as an absent delivery', async () => {
    const { service, delivery } = setup();
    await expect(
      service.getDeliveryCodeFor(actor(COURIER, ['courier']), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses another customer', async () => {
    const { service, delivery } = setup();
    await expect(
      service.getDeliveryCodeFor(actor('customer-stranger'), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses staff-tier — no ops flow needs it, and a compromised support account must not be a fraud path', async () => {
    const { service, delivery } = setup();
    const staff = {
      userId: 'admin-1',
      roles: ['admin'],
      permissions: ['deliveries:read', 'deliveries:write'],
    } as unknown as AccessActor;
    await expect(service.getDeliveryCodeFor(staff, delivery.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s on an unknown delivery id, indistinguishably from a forbidden one', async () => {
    const { service } = setup();
    await expect(
      service.getDeliveryCodeFor(actor(CUSTOMER_ID), 'does-not-exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('getDeliveryCodeFor — lifecycle of the code itself', () => {
  it('404s before pickup, when no code has been issued yet', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    await expect(
      service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s once the code has been consumed — a delivered order has nothing left to show', async () => {
    const { service, delivery } = setup('4242', { consumedAt: new Date() });
    await expect(
      service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on an expired code rather than handing out one the courier can no longer use', async () => {
    const { service, delivery } = setup('4242', { expiresAt: new Date(Date.now() - 1_000) });
    await expect(
      service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says so honestly when a legacy row has no encrypted copy, instead of inventing a code', async () => {
    // A proof issued before this column was written: the raw value is
    // unrecoverable BY DESIGN (only its hash exists), so the only correct
    // answer is "re-issue", never a fresh code that would not match the hash
    // the courier's `confirmDelivered` verifies against.
    const { service, delivery } = setup('4242', { reference: null });
    await expect(
      service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the code it returns is the one confirmDelivered accepts (end-to-end round trip)', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
    await service.acceptOffer(delivery.id, COURIER, 'k-accept');
    await service.markPickedUp(delivery.id, COURIER, 'k-pickup');

    const { code } = await service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id);
    await service.confirmDelivered(delivery.id, COURIER, code, 'k-deliver');

    expect(delivery.status).toBe('delivered');
  });
});

describe('FEAT-012 / SPEC-012-02 — a code chosen when the order is taken on the phone', () => {
  it('SPEC-012-02-SC01 — the code given during the call is the one issued at pickup and accepted at the door', async () => {
    const { db, deliveries, offers, couriers, proofs, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);

    const given = await service.presetDeliveryCode(delivery.orderId, 'operator-1');
    expect(given).toMatch(/^\d{4}$/);
    // asked again (retry, second screen): the same code, never a new one
    expect(await service.presetDeliveryCode(delivery.orderId, 'operator-1')).toBe(given);

    const issued = await service.issueDeliveryCode(delivery.id, COURIER);
    expect(issued).toBe(given);
    const stored = proofs.find((p) => p.deliveryId === delivery.id)!;
    expect(stored.valueHash).not.toContain(given); // still hashed, never raw at rest
    const read = await service.getDeliveryCodeFor(actor(CUSTOMER_ID), delivery.id);
    expect(read.code).toBe(given);
  });

  it('SPEC-012-02-SC02 — without a preset, pickup still draws a fresh random code', async () => {
    const { db, deliveries, offers, couriers, ledgerGroups } = makeDeliveriesRaceDb();
    const { delivery } = seedAssignedOffer(deliveries, offers, couriers, COURIER);
    const { deliveries: service } = buildDeliveriesServices(db, ledgerGroups);
    const issued = await service.issueDeliveryCode(delivery.id, COURIER);
    expect(issued).toMatch(/^\d{4}$/);
  });
});
