import { z } from 'zod';

/**
 * FEAT-023 — free WhatsApp login (SPEC-023-01, SPEC-023-03): a screen asks for
 * a code to SEND, then asks where it stands with the token it was given.
 */

/** No `challengeId`: a login; with one: the code of a password login on a new device. */
export const WhatsappStartSchema = z.object({ challengeId: z.string().uuid().optional() }).strict();
export type WhatsappStartInput = z.infer<typeof WhatsappStartSchema>;

/** The token is base64url (32 bytes → 43 characters); `rememberDevice` only matters for a new device. */
export const WhatsappStatusSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'invalid token'),
    rememberDevice: z.boolean().default(false),
  })
  .strict();
export type WhatsappStatusInput = z.infer<typeof WhatsappStatusSchema>;

/** `POST /me/phone/whatsapp`: nothing to send, the account comes from the access token. */
export const PhoneWhatsappSchema = z.object({}).strict();
export type PhoneWhatsappInput = z.infer<typeof PhoneWhatsappSchema>;
