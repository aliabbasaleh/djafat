import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Reading the operator's confirmation SMS received on DJAFAT's merchant
 * phones (FEAT-016, SPEC-016-01). Pure.
 *
 * TEMPLATES ARE EXAMPLES. The exact wording of Airtel Money and Moov Money
 * SMS in Chad must be taken from real messages (FEAT-016-Q01); until then an
 * SMS that matches no template is simply handed to the team, never guessed.
 * A new wording = a new versioned template, the old one kept for history.
 */
interface SmsTemplate {
  readonly id: string;
  readonly senders: readonly string[];
  readonly pattern: RegExp;
}

const TEMPLATES: Readonly<Record<string, readonly SmsTemplate[]>> = {
  airtel_money: [
    {
      id: 'airtel_money/v1',
      senders: ['AirtelMoney', 'Airtel Money'],
      pattern:
        /recu (?<amount>[\d  .]+) ?F?CFA de (?<sender>\+?\d{8,12}).*?Trans(?:action)? ?ID ?: ?(?<ref>[A-Z0-9.-]+).*?solde ?: ?(?<balance>[\d  .]+)/is,
    },
  ],
  tigo_cash: [
    {
      id: 'tigo_cash/v1',
      senders: ['MoovMoney', 'Moov Money', 'TigoCash'],
      pattern:
        /re[çc]u (?<amount>[\d  .]+) ?F?CFA de (?<sender>\+?\d{8,12}).*?R[ée]f(?:[ée]rence)? ?: ?(?<ref>[A-Z0-9.-]+).*?solde ?: ?(?<balance>[\d  .]+)/is,
    },
  ],
};

export type ParsedSms =
  | {
      readonly kind: 'receipt';
      readonly amountMinor: bigint;
      readonly senderPhone: string;
      readonly transactionRef: string;
      readonly balanceMinor: bigint | null;
      readonly template: string;
    }
  | { readonly kind: 'ignored'; readonly reason: 'unknown_sender' | 'no_template' };

const digits = (s: string | undefined): bigint | null => {
  const d = (s ?? '').replace(/\D/g, '');
  return d ? BigInt(d) : null;
};

export function parseOperatorSms(providerCode: string, sender: string, body: string): ParsedSms {
  const templates = TEMPLATES[providerCode] ?? [];
  const known = templates.filter((t) => t.senders.includes(sender.trim()));
  if (known.length === 0) return { kind: 'ignored', reason: 'unknown_sender' };
  for (const t of known) {
    const m = t.pattern.exec(body);
    const amount = digits(m?.groups?.['amount']);
    if (m?.groups && amount && amount > 0n && m.groups['ref'] && m.groups['sender']) {
      return {
        kind: 'receipt',
        amountMinor: amount,
        senderPhone: m.groups['sender'],
        transactionRef: m.groups['ref'].replace(/\.$/, ''),
        balanceMinor: digits(m.groups['balance']),
        template: t.id,
      };
    }
  }
  return { kind: 'ignored', reason: 'no_template' };
}

/** A forged SMS cannot know the merchant balance: new = old + amount, when both are known. */
export function balanceIsContinuous(
  previous: bigint | null,
  amount: bigint,
  next: bigint | null,
): boolean {
  if (previous === null || next === null) return true;
  return next === previous + amount;
}

const MAX_SKEW_MS = 5 * 60 * 1000;

/** HMAC-SHA256 over `${timestamp}.${rawBody}` with the device secret, within 5 minutes. */
export function verifyGatewaySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHex: string,
  nowMs: number,
): boolean {
  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const given = Buffer.from(signatureHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
