import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';

/**
 * `POST /v1/deliveries` (docs/25 §45). Admin/ops-only manual trigger — the
 * primary path is automatic (`orders`' `order.ready` event, docs/25 §11);
 * this exists for re-dispatch after an operational incident. Idempotent: if
 * a delivery already exists for the order, returns it unchanged.
 */
export const CreateDeliverySchema = z.object({ orderId: UuidSchema }).strict();
export type CreateDeliveryInput = z.infer<typeof CreateDeliverySchema>;
