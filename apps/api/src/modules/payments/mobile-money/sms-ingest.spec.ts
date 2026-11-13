import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { SmsIngestService } from './sms-ingest.service';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { MerchantWalletPaymentProvider } from '../providers/wallet/merchant-wallet-payment.provider';

// FEAT-016 — docs/features/FEAT-016-merchant-sms-ingestion (SPEC-016-02).

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = 1_762_700_000_000;
const sms = (seq: number, amount: string, balance: string, ref = `CI${seq}`) =>
  JSON.stringify({
    seq,
    from: 'AirtelMoney',
    body: `Vous avez recu ${amount} FCFA de 66123456. Trans ID: ${ref}. Nouveau solde: ${balance} FCFA.`,
    receivedAt: '2026-11-09T14:00:00Z',
  });

function harness(opts: { key?: string } = {}) {
  type Device = {
    id: string;
    providerCode: string;
    label: string;
    secretEnc: string;
    createdBy: string;
    active: boolean;
    lastSeq: bigint;
    lastSeenAt: Date | null;
    lastBalanceMinor: bigint | null;
    createdAt: Date;
  };
  const devices: Device[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    smsGatewayDevice: {
      create: vi.fn(async ({ data }: { data: Partial<Device> }) => {
        const d = {
          id: `dev-${devices.length + 1}`,
          active: true,
          lastSeq: 0n,
          lastSeenAt: null,
          lastBalanceMinor: null,
          createdAt: new Date(),
          ...data,
        } as Device;
        devices.push(d);
        return d;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          devices.find((d) => d.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => devices),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Device> }) =>
        Object.assign(devices.find((d) => d.id === where.id)!, data),
      ),
    },
    mobileMoneySms: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (rows.push(data), data)),
      findUnique: vi.fn(
        async ({ where }: { where: { deviceId_seq: { deviceId: string; seq: bigint } } }) =>
          rows.find(
            (r) =>
              r['deviceId'] === where.deviceId_seq.deviceId && r['seq'] === where.deviceId_seq.seq,
          ) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { outcome: { in: string[] } } }) =>
        rows.filter((r) => where.outcome.in.includes(r['outcome'] as string)),
      ),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  const config = { get: vi.fn(() => opts.key ?? KEY) };
  const registry = new PaymentProviderRegistry([
    new MerchantWalletPaymentProvider('airtel_money', '+23560000010'),
  ]);
  const recorded: Array<Record<string, unknown>> = [];
  const receipts = {
    recordReceipt: vi.fn(
      async (input: { transactionRef: string }, _by: unknown, source: string) => {
        if (recorded.some((r) => r['transactionRef'] === input.transactionRef)) {
          throw new ConflictException({ code: 'RECEIPT_ALREADY_RECORDED', message: 'dup' });
        }
        recorded.push({ ...input, source });
        return { receipt: { id: `rc-${recorded.length}` }, matchedPaymentId: 'pay-1' };
      },
    ),
  };
  const service = new SmsIngestService(db as never, config as never, registry, receipts as never);
  const sign = (secret: string, body: string, ts = String(NOW / 1000)) => ({
    timestamp: ts,
    signature: createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex'),
  });
  return { service, devices, rows, recorded, receipts, sign };
}

describe('SPEC-016-02 — merchant SMS gateways', () => {
  it('SPEC-016-02-SC01 — a registered phone gets its secret once; it is stored encrypted', async () => {
    const h = harness();
    const d = await h.service.registerDevice('airtel_money', 'Téléphone Airtel 1', 'staff-1');
    expect(d.secret.length).toBeGreaterThan(20);
    expect(h.devices[0]!.secretEnc).not.toContain(d.secret);
    await expect(h.service.registerDevice('unknown_wallet', 'x', 'staff-1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      harness({ key: '' }).service.registerDevice('airtel_money', 'x', 's'),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('SPEC-016-02-SC02 — unknown phone, bad signature or a replayed sequence: 401, nothing recorded', async () => {
    const h = harness();
    const d = await h.service.registerDevice('airtel_money', 'P1', 'staff-1');
    const body = sms(1, '6 500', '106 500');
    await expect(
      h.service.ingest('dev-404', h.sign(d.secret, body), body, NOW),
    ).rejects.toMatchObject({ status: 401 });
    await expect(h.service.ingest(d.id, h.sign('wrong', body), body, NOW)).rejects.toMatchObject({
      status: 401,
    });
    await h.service.ingest(
      d.id,
      h.sign(d.secret, sms(5, '1 000', '1 000')),
      sms(5, '1 000', '1 000'),
      NOW,
    );
    const older = sms(3, '2 000', '3 000');
    await expect(h.service.ingest(d.id, h.sign(d.secret, older), older, NOW)).rejects.toMatchObject(
      { status: 401 },
    );
    expect(h.recorded).toHaveLength(1);
  });

  it('SPEC-016-02-SC03 — a transfer SMS is recorded as from the SMS forwarder and matched; a resend answers the same once', async () => {
    const h = harness();
    const d = await h.service.registerDevice('airtel_money', 'P1', 'staff-1');
    const body = sms(1, '6 500', '106 500');
    const r = await h.service.ingest(d.id, h.sign(d.secret, body), body, NOW);
    expect(r).toEqual({ outcome: 'recorded', receiptId: 'rc-1', matchedPaymentId: 'pay-1' });
    expect(h.recorded[0]).toMatchObject({
      transactionRef: 'CI1',
      amount: { minor: 6500n, currency: 'XAF' },
      senderPhone: '66123456',
      source: 'sms_forwarder',
    });
    const again = await h.service.ingest(d.id, h.sign(d.secret, body), body, NOW);
    expect(again.outcome).toBe('recorded');
    expect(h.receipts.recordReceipt).toHaveBeenCalledTimes(1);
    expect(h.devices[0]!.lastBalanceMinor).toBe(106_500n);
  });

  it('SPEC-016-02-SC04 — a balance that does not follow is quarantined and keeps the old reference', async () => {
    const h = harness();
    const d = await h.service.registerDevice('airtel_money', 'P1', 'staff-1');
    const first = sms(1, '6 500', '106 500');
    await h.service.ingest(d.id, h.sign(d.secret, first), first, NOW);
    const forged = sms(2, '50 000', '999 999', 'FAKE1');
    expect((await h.service.ingest(d.id, h.sign(d.secret, forged), forged, NOW)).outcome).toBe(
      'quarantined',
    );
    expect(h.devices[0]!.lastBalanceMinor).toBe(106_500n);
    const next = sms(3, '3 500', '110 000');
    expect((await h.service.ingest(d.id, h.sign(d.secret, next), next, NOW)).outcome).toBe(
      'recorded',
    );
    expect(h.recorded.map((r) => r['transactionRef'])).toEqual(['CI1', 'CI3']);
  });

  it('SPEC-016-02-SC05 — another sender, an unknown wording or a number already typed by the team: kept, no new transfer', async () => {
    const h = harness();
    const d = await h.service.registerDevice('airtel_money', 'P1', 'staff-1');
    const other = JSON.stringify({
      seq: 1,
      from: '+23566999999',
      body: 'Vous avez recu 9 000 FCFA de 66123456. Trans ID: X1. Nouveau solde: 9 000 FCFA.',
      receivedAt: '2026-11-09T14:00:00Z',
    });
    expect((await h.service.ingest(d.id, h.sign(d.secret, other), other, NOW)).outcome).toBe(
      'unknown_sender',
    );
    const promo = JSON.stringify({
      seq: 2,
      from: 'AirtelMoney',
      body: 'Profitez de nos offres',
      receivedAt: '2026-11-09T14:00:00Z',
    });
    expect((await h.service.ingest(d.id, h.sign(d.secret, promo), promo, NOW)).outcome).toBe(
      'no_template',
    );
    h.recorded.push({ transactionRef: 'CI3' }); // typed by the team first
    const dup = sms(3, '2 000', '2 000');
    expect((await h.service.ingest(d.id, h.sign(d.secret, dup), dup, NOW)).outcome).toBe(
      'duplicate',
    );
    expect((await h.service.listForReview()).map((r) => r.outcome)).toEqual([
      'unknown_sender',
      'no_template',
    ]);
  });
});
