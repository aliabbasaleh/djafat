import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/deliveries`. No `courierId` in the body: the Bloc 0.5 skeleton
 * resolves the single seeded test courier at order-creation time (docs/18
 * §4) — real dispatch is Bloc 6.
 */
export const AssignDeliverySchema = z.object({ orderId: UuidSchema }).strict();
export type AssignDeliveryInput = z.infer<typeof AssignDeliverySchema>;
