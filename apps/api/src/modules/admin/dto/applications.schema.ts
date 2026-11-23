import { z } from 'zod';
import { APPLICATION_MESSAGES, COURIER_DOCUMENT_KINDS, checkRejectionReason } from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-07): « Demandes à vérifier ». The two tabs; decisions
 * and photo links take `courier` in this part — a restaurant's application is
 * decided once its four steps exist (SPEC-022-05, part 3).
 */
export const ApplicationsQuerySchema = z
  .object({ type: z.enum(['restaurant', 'courier']).default('restaurant') })
  .strict();
export type ApplicationsQueryInput = z.infer<typeof ApplicationsQuerySchema>;

export const ReviewedApplicationTypeSchema = z.literal('courier');

export const ApplicationIdSchema = z.string().uuid();

export const CourierDocumentKindParamSchema = z.enum(COURIER_DOCUMENT_KINDS);

/** R4: a reason of 10 to 500 characters, sent to the applicant. */
export const RejectApplicationSchema = z
  .object({ reason: z.string() })
  .strict()
  .transform((v, ctx) => {
    const checked = checkRejectionReason(v.reason);
    if (checked.ok) return { reason: checked.reason };
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: APPLICATION_MESSAGES[checked.error],
    });
    return z.NEVER;
  });
export type RejectApplicationInput = z.infer<typeof RejectApplicationSchema>;
