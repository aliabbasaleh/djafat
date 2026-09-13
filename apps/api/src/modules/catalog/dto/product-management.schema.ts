import { z } from 'zod';
import { UuidSchema } from '@djafat/validation';
import { OPTION_SELECTION_TYPES } from '@djafat/types';

const MoneyMinorSchema = z
  .string()
  .regex(/^\d+$/, 'must be a plain non-negative integer string')
  .transform((v) => BigInt(v));
/** Option deltas may be negative (e.g. a smaller size costing less) — docs/20 §17. */
const MoneyDeltaMinorSchema = z
  .string()
  .regex(/^-?\d+$/, 'must be a plain integer string')
  .transform((v) => BigInt(v));

export const CreateProductSchema = z
  .object({
    categoryId: UuidSchema.optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    imageUrl: z.string().url().max(500).optional(),
    priceMinor: MoneyMinorSchema,
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z
  .object({
    categoryId: UuidSchema.nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    imageUrl: z.string().url().max(500).optional(),
    priceMinor: MoneyMinorSchema.optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const UpdateProductAvailabilitySchema = z.object({ isAvailable: z.boolean() }).strict();
export type UpdateProductAvailabilityInput = z.infer<typeof UpdateProductAvailabilitySchema>;

const CreateOptionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    priceDeltaMinor: MoneyDeltaMinorSchema,
  })
  .strict();

export const CreateOptionGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    selectionType: z.enum(OPTION_SELECTION_TYPES),
    minSelections: z.number().int().min(0).max(20),
    maxSelections: z.number().int().min(1).max(20),
    isRequired: z.boolean(),
    options: z.array(CreateOptionSchema).min(1).max(20),
  })
  .strict()
  .refine((v) => v.maxSelections >= v.minSelections, {
    message: 'maxSelections must be >= minSelections',
    path: ['maxSelections'],
  })
  .refine((v) => v.selectionType !== 'single' || v.maxSelections === 1, {
    message: 'a "single" selection group must have maxSelections === 1',
    path: ['maxSelections'],
  });
export type CreateOptionGroupInput = z.infer<typeof CreateOptionGroupSchema>;

export const UpdateOptionGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    minSelections: z.number().int().min(0).max(20).optional(),
    maxSelections: z.number().int().min(1).max(20).optional(),
    isRequired: z.boolean().optional(),
  })
  .strict();
export type UpdateOptionGroupInput = z.infer<typeof UpdateOptionGroupSchema>;
