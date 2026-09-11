import type { Permission, Role } from './enums.js';

/**
 * The authenticated caller, resolved server-side from a verified access
 * token — NEVER from a client-supplied field (docs/19 §2). Attached to the
 * request by `AuthGuard` (module `auth`) and consumed by any module via the
 * `@CurrentActor()` param decorator (`common/auth-context`) — no module
 * needs to import `auth` itself to read it, only the shared shape.
 */
export interface AuthenticatedActor {
  readonly userId: string;
  readonly sessionId: string;
  /** All roles currently granted to this user (`user_roles`), deduplicated. */
  readonly roles: readonly Role[];
  /** Resolved via `role_permissions` — the union of every granted role's permissions. */
  readonly permissions: readonly Permission[];
  /**
   * Set when this session passed step-up re-authentication (MFA) within the
   * configured window (docs/19 §11). `null` = never / expired.
   */
  readonly stepUpVerifiedAt: string | null;
}
