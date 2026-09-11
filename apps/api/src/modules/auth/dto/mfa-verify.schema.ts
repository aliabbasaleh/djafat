import { z } from 'zod';

export const MfaVerifySchema = z
  .object({ code: z.string().regex(/^\d{6}$/, 'code must be 6 digits') })
  .strict();
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;
