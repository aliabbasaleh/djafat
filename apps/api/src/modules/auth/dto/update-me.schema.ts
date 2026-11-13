import { z } from 'zod';

/** `PATCH /v1/me` ("Mon profil"): the name shown to the courier and the restaurant. */
export const UpdateMeSchema = z
  .object({ fullName: z.string().trim().min(2, 'nom trop court').max(80, 'nom trop long') })
  .strict();
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
