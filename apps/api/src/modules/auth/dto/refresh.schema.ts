import { z } from 'zod';

export const RefreshSchema = z.object({ refresh: z.string().min(16) }).strict();
export type RefreshInput = z.infer<typeof RefreshSchema>;
