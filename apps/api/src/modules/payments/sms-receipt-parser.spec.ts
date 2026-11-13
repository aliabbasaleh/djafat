import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  balanceIsContinuous,
  parseOperatorSms,
  verifyGatewaySignature,
} from './sms-receipt-parser';

// FEAT-016 — docs/features/FEAT-016-merchant-sms-ingestion (SPEC-016-01).

const AIRTEL_SMS =
  'Vous avez recu 6 500 FCFA de 66123456. Trans ID: CI251109.1530.P8858. Nouveau solde: 106 500 FCFA.';

describe('SPEC-016-01 — reading an operator SMS (pure)', () => {
  it('SPEC-016-01-SC01 — a signature over timestamp and body, recent, is accepted; anything else is not', () => {
    const secret = 'device-secret';
    const body = '{"seq":3}';
    const ts = '1762700000';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const now = 1762700000 * 1000 + 60_000;
    expect(verifyGatewaySignature(secret, ts, body, sig, now)).toBe(true);
    expect(verifyGatewaySignature(secret, ts, body + ' ', sig, now)).toBe(false); // body changed
    expect(verifyGatewaySignature('other', ts, body, sig, now)).toBe(false); // wrong device
    expect(verifyGatewaySignature(secret, ts, body, sig, now + 10 * 60_000)).toBe(false); // too old
    expect(verifyGatewaySignature(secret, ts, body, 'zz', now)).toBe(false);
  });

  it('SPEC-016-01-SC02 — a transfer SMS from the operator gives amount, sender, number and balance', () => {
    expect(parseOperatorSms('airtel_money', 'AirtelMoney', AIRTEL_SMS)).toEqual({
      kind: 'receipt',
      amountMinor: 6500n,
      senderPhone: '66123456',
      transactionRef: 'CI251109.1530.P8858',
      balanceMinor: 106_500n,
      template: 'airtel_money/v1',
    });
  });

  it('SPEC-016-01-SC03 — another sender, or an SMS no template knows, is never read as a transfer', () => {
    expect(parseOperatorSms('airtel_money', '+23566999999', AIRTEL_SMS)).toEqual({
      kind: 'ignored',
      reason: 'unknown_sender',
    });
    expect(
      parseOperatorSms('airtel_money', 'AirtelMoney', 'Votre forfait internet expire demain.'),
    ).toEqual({
      kind: 'ignored',
      reason: 'no_template',
    });
  });

  it('SPEC-016-01-SC04 — the new balance must be the old one plus the amount', () => {
    expect(balanceIsContinuous(100_000n, 6_500n, 106_500n)).toBe(true);
    expect(balanceIsContinuous(100_000n, 6_500n, 156_500n)).toBe(false); // a forged SMS
    expect(balanceIsContinuous(null, 6_500n, 106_500n)).toBe(true); // first SMS: becomes the reference
    expect(balanceIsContinuous(100_000n, 6_500n, null)).toBe(true); // no balance in the text
  });
});
