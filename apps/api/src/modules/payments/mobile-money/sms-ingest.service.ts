import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AppConfigService } from '../../../common/config/config.service';
import { decryptAtRest, encryptAtRest } from '../../../common/crypto/at-rest';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { MobileMoneyReceiptsService } from './mobile-money-receipts.service';
import {
  balanceIsContinuous,
  parseOperatorSms,
  verifyGatewaySignature,
} from '../sms-receipt-parser';

const KEY_NAME = 'SMS_GATEWAY_ENCRYPTION_KEY';
const SILENT_AFTER_MS = 5 * 60 * 1000;

/** What a gateway phone posts (the raw body is what is signed). */
const ForwardedSmsSchema = z
  .object({
    seq: z.number().int().positive(),
    from: z.string().min(1).max(64),
    body: z.string().min(1).max(1000),
    receivedAt: z.coerce.date(),
  })
  .strict();

export type SmsOutcome =
  | 'recorded'
  | 'duplicate'
  | 'quarantined'
  | 'unknown_sender'
  | 'no_template';

/**
 * Merchant SMS gateways (FEAT-016, SPEC-016-02): phones that forward the
 * operator's confirmation SMS. Each SMS must be signed with its device's
 * secret and carry a sequence number never seen; a transfer read from it goes
 * through the very same recording and matching as a manual entry (FEAT-009).
 * A balance that does not follow the previous one (new = old + amount), a
 * sender that is not the operator's, or a wording no template knows: kept for
 * the team, never turned into a transfer.
 */
@Injectable()
export class SmsIngestService {
  private readonly logger = new Logger(SmsIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly registry: PaymentProviderRegistry,
    private readonly receipts: MobileMoneyReceiptsService,
  ) {}

  /** Staff register a phone; its secret is shown ONCE and stored encrypted. */
  async registerDevice(providerCode: string, label: string, staffUserId: string) {
    const key = this.key();
    if (
      !this.registry.has(providerCode) ||
      this.registry.get(providerCode).getCapabilities().matchedByTransferReceipt !== true
    ) {
      throw new NotFoundException({
        code: 'PROVIDER_UNAVAILABLE',
        message: `No merchant wallet "${providerCode}" is configured.`,
      });
    }
    const secret = randomBytes(24).toString('base64url');
    const device = await this.prisma.smsGatewayDevice.create({
      data: {
        providerCode,
        label,
        secretEnc: encryptAtRest(secret, key, KEY_NAME),
        createdBy: staffUserId,
      },
    });
    return { id: device.id, providerCode, label, secret };
  }

  async listDevices(now = new Date()) {
    const rows = await this.prisma.smsGatewayDevice.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((d) => ({
      id: d.id,
      providerCode: d.providerCode,
      label: d.label,
      active: d.active,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      silent: !d.lastSeenAt || now.getTime() - d.lastSeenAt.getTime() > SILENT_AFTER_MS,
    }));
  }

  /** SMS the team must look at: quarantined, unknown sender, or not understood. */
  async listForReview() {
    const rows = await this.prisma.mobileMoneySms.findMany({
      where: { outcome: { in: ['quarantined', 'unknown_sender', 'no_template'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      sender: r.sender,
      body: r.body,
      receivedAt: r.receivedAt.toISOString(),
      outcome: r.outcome,
    }));
  }

  async ingest(
    deviceId: string,
    headers: { timestamp?: string | undefined; signature?: string | undefined },
    rawBody: string,
    now = Date.now(),
  ): Promise<{ outcome: SmsOutcome; receiptId: string | null; matchedPaymentId: string | null }> {
    const key = this.key();
    const unauthorized = new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Unknown device or invalid signature.',
    });
    const device = await this.prisma.smsGatewayDevice.findUnique({ where: { id: deviceId } });
    if (!device || !device.active || !headers.timestamp || !headers.signature) throw unauthorized;
    const secret = decryptAtRest(device.secretEnc, key, KEY_NAME);
    if (!verifyGatewaySignature(secret, headers.timestamp, rawBody, headers.signature, now)) {
      throw unauthorized;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
    const parsedBody = ForwardedSmsSchema.safeParse(json);
    if (!parsedBody.success) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'Malformed forwarded SMS.',
      });
    }
    const sms = parsedBody.data;

    // One SMS of a device at a time: sequence and balance reference stay coherent.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sms-gateway:${deviceId}`}))`;
        const current = (await tx.smsGatewayDevice.findUnique({ where: { id: deviceId } }))!;
        const seq = BigInt(sms.seq);
        if (seq <= current.lastSeq) {
          // A resend of an SMS already processed answers the same; anything else is a replay.
          const seen = await tx.mobileMoneySms.findUnique({
            where: { deviceId_seq: { deviceId, seq } },
          });
          if (seen) {
            return {
              outcome: seen.outcome as SmsOutcome,
              receiptId: seen.receiptId,
              matchedPaymentId: null,
            };
          }
          throw unauthorized;
        }

        const parsed = parseOperatorSms(current.providerCode, sms.from, sms.body);
        let outcome: SmsOutcome;
        let receiptId: string | null = null;
        let matchedPaymentId: string | null = null;
        let nextBalance = current.lastBalanceMinor;
        if (parsed.kind === 'ignored') {
          outcome = parsed.reason;
        } else if (
          !balanceIsContinuous(current.lastBalanceMinor, parsed.amountMinor, parsed.balanceMinor)
        ) {
          outcome = 'quarantined'; // keep the old reference: a forged SMS must not move it
          this.logger.warn(`sms ${deviceId}#${sms.seq}: balance does not follow — quarantined`);
        } else {
          nextBalance = parsed.balanceMinor; // null clears the reference (FEAT-016-Q04)
          try {
            const r = await this.receipts.recordReceipt(
              {
                providerCode: current.providerCode,
                transactionRef: parsed.transactionRef,
                amount: { minor: parsed.amountMinor, currency: 'XAF' },
                senderPhone: parsed.senderPhone,
                receivedAt: sms.receivedAt,
              },
              null,
              'sms_forwarder',
            );
            outcome = 'recorded';
            receiptId = r.receipt.id;
            matchedPaymentId = r.matchedPaymentId;
          } catch (err) {
            if (
              err instanceof ConflictException &&
              (err.getResponse() as { code?: string }).code === 'RECEIPT_ALREADY_RECORDED'
            ) {
              outcome = 'duplicate'; // already typed by the team, or forwarded twice
            } else {
              throw err;
            }
          }
        }
        await tx.mobileMoneySms.create({
          data: {
            deviceId,
            seq,
            sender: sms.from,
            body: sms.body,
            receivedAt: sms.receivedAt,
            outcome,
            template: parsed.kind === 'receipt' ? parsed.template : null,
            receiptId,
          },
        });
        await tx.smsGatewayDevice.update({
          where: { id: deviceId },
          data: { lastSeq: seq, lastSeenAt: new Date(now), lastBalanceMinor: nextBalance },
        });
        return { outcome, receiptId, matchedPaymentId };
      },
      { timeout: 20_000 },
    );
  }

  private key(): string {
    const key = this.config.get(KEY_NAME);
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'SMS ingestion is not configured on this server.',
      });
    }
    return key;
  }
}
