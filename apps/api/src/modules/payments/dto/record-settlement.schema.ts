import { z } from 'zod';

const MINOR_INT_STRING_RE = /^(?:0|[1-9]\d*)$/;
const minorAmount = () =>
  z.string().regex(MINOR_INT_STRING_RE, 'must be a plain non-negative integer string');

/**
 * `POST /v1/admin/settlements` — records what a PSP statement says it paid
 * out for a period (docs/08 §8.9 "Settlement & réconciliation"). Deliberately
 * manual input, not statement ingestion: the mandate explicitly excludes a
 * full banking/reconciliation engine from this bloc (semi-manual V1.1-tier
 * primitive).
 */
export const RecordSettlementSchema = z
  .object({
    providerCode: z.string().min(1).max(40),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    currency: z.string().length(3),
    grossMinor: minorAmount(),
    feesMinor: minorAmount(),
    netMinor: minorAmount(),
    providerReference: z.string().max(200).optional(),
    /** What our own ledger expects the net to be, for the discrepancy flag — never auto-corrected. */
    expectedNetMinor: minorAmount().optional(),
  })
  .strict();

export type RecordSettlementInput = z.infer<typeof RecordSettlementSchema>;
