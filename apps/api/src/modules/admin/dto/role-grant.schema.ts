import { z } from 'zod';
import { ROLES } from '@djafat/types';

/**
 * `POST /v1/admin/users/:id/roles` (Bloc 9, docs/30 §role-management).
 * `scopeRestaurantId` is required for `restaurant_owner`/`restaurant_staff`
 * and forbidden for every other role — `UsersService.grantRole` is the one
 * place that invariant is actually enforced (docs/30), this schema only
 * checks shape (a uuid or absent), never the role-dependent business rule.
 */
export const GrantRoleSchema = z
  .object({
    role: z.enum(ROLES),
    scopeRestaurantId: z.string().uuid().optional(),
  })
  .strict();
export type GrantRoleInput = z.infer<typeof GrantRoleSchema>;

/** `DELETE /v1/admin/users/:id/roles/:role?scopeRestaurantId=` — the scope is a query param since the role alone isn't always a unique grant. */
export const RevokeRoleQuerySchema = z
  .object({
    scopeRestaurantId: z.string().uuid().optional(),
  })
  .strict();
export type RevokeRoleQueryInput = z.infer<typeof RevokeRoleQuerySchema>;

export const RoleParamSchema = z.enum(ROLES);

/** A free-text justification for a sensitive lifecycle action (suspend/block/reactivate) — always audited verbatim. */
export const ReasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type ReasonInput = z.infer<typeof ReasonSchema>;

export const SearchUsersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchUsersQueryInput = z.infer<typeof SearchUsersQuerySchema>;
