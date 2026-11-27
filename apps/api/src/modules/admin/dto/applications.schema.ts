import { z } from 'zod';
import {
  APPLICATION_MESSAGES,
  COURIER_DOCUMENT_KINDS,
  RESTAURANT_DOCUMENT_KINDS,
  checkRejectionReason,
} from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-07): « Demandes à vérifier » — the two tabs, the
 * decisions on an application and on a change after the approval (R6).
 */
export const ApplicationTypeSchema = z.enum(['restaurant', 'courier']);
export type ApplicationTypeInput = z.infer<typeof ApplicationTypeSchema>;

export const ApplicationsQuerySchema = z
  .object({ type: ApplicationTypeSchema.default('restaurant') })
  .strict();
export type ApplicationsQueryInput = z.infer<typeof ApplicationsQuerySchema>;

export const ApplicationIdSchema = z.string().uuid();

/** A courier's photo or a restaurant's paper; the service checks it belongs to the type. */
export const ApplicationFileKindSchema = z.enum([
  ...COURIER_DOCUMENT_KINDS,
  ...RESTAURANT_DOCUMENT_KINDS,
]);
export type ApplicationFileKindInput = z.infer<typeof ApplicationFileKindSchema>;

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
