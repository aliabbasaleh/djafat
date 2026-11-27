import { z } from 'zod';
import { makePersonNameSchema } from '@djafat/validation';

/**
 * `PATCH /v1/me` ("Mon profil"): the name shown to the courier and the
 * restaurant — a person's name, letters only (FEAT-024, SPEC-024-03).
 */
export const UpdateMeSchema = z.object({ fullName: makePersonNameSchema() }).strict();
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
