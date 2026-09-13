import { z } from 'zod';

export const CreateMenuCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    imageUrl: z.string().url().max(500).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type CreateMenuCategoryInput = z.infer<typeof CreateMenuCategorySchema>;

export const UpdateMenuCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    imageUrl: z.string().url().max(500).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateMenuCategoryInput = z.infer<typeof UpdateMenuCategorySchema>;
