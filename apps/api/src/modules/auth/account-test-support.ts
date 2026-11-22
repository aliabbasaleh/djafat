import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import type { Role } from '@djafat/types';
import type { AuditService } from '../../common/audit/audit.service';
import type { AppConfigService } from '../../common/config/config.service';
import type { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PlatformService } from '../platform/platform.service';
import type { UserRecord, UsersService } from '../users/users.service';
import type { AccountNotice, AccountNoticePort, NoticeOutcome } from './account-notice.port';
import { AuthService } from './auth.service';
import type { MfaService } from './mfa.service';
import type { OtpPurpose, OtpRequestOptions, OtpService, OtpTarget } from './otp.service';
import type { SessionService } from './session.service';
import type { TokenService } from './token.service';
import type { TrustedDeviceService } from './trusted-device.service';

/**
 * Test support for FEAT-020's use cases (registration, password, phone
 * link): in-memory fakes that keep the documented semantics of the real
 * collaborators — the latest unconsumed code for (channel, target, purpose,
 * context) verifies once (otp.service.ts), one non-deleted account per phone
 * and per email (migration 0003), a lock after 10 failures. The REAL
 * `AuthService` opens the sessions, on fake sessions and tokens.
 * Test code only.
 */

export const META = { ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Android 14)' };

/** A fake async method: runs `fn`, resolves its result, rejects what it throws. */
const later =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): Promise<R> =>
    Promise.resolve().then(() => fn(...args));

export interface SentCode {
  readonly to: OtpTarget;
  readonly purpose: OtpPurpose;
  readonly context: string | null;
  readonly code: string;
  consumed: boolean;
}

/** A stored account; unlike `UserRecord`, the fakes and tests may change it in place. */
export interface Account extends Omit<UserRecord, 'phoneVerifiedAt' | 'email' | 'emailVerifiedAt'> {
  phoneVerifiedAt: Date | null;
  /** Mutable like `phoneVerifiedAt`: the e-mail change tests confirm a new address (SPEC-020-12). */
  email: string | null;
  emailVerifiedAt?: Date | null;
  passwordHash: string | null;
  deleted?: boolean;
}

interface ChallengeRow {
  id: string;
  kind: string;
  userId: string | null;
  email: string;
  payload: unknown;
  expiresAt: Date;
  consumedAt: Date | null;
}

const otpInvalid = () =>
  new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });
const otpLocked = () => new HttpException({ code: 'OTP_LOCKED', message: 'locked' }, 423);
const rateLimited = () =>
  new HttpException({ code: 'RATE_LIMITED', message: 'Too many codes requested' }, 429);
const LOCK_THRESHOLD = 10;
/** Like `otp_request_rate_limit_per_target` (3 per 10 min): the fake has no clock, one window per test. */
const TARGET_BUDGET = 3;

export function fakeOtp() {
  const sent: SentCode[] = [];
  const failures = new Map<string, number>();
  const locked = (target: string) => (failures.get(target) ?? 0) >= LOCK_THRESHOLD;
  const fail = (target: string) => failures.set(target, (failures.get(target) ?? 0) + 1);
  // Review FEAT-020 #10: the fake now applies the per-target budget and the lock
  // where the real service does, so tests see what a caller would see.
  const budgets = new Map<string, number>();
  const spend = (target: string) => {
    const used = (budgets.get(target) ?? 0) + 1;
    budgets.set(target, used);
    if (used > TARGET_BUDGET) throw rateLimited();
  };
  const push = (to: OtpTarget, purpose: OtpPurpose, context: string | null) =>
    sent.push({ to, purpose, context, code: String(100_000 + sent.length), consumed: false });
  const otp = {
    sent,
    failures,
    consumeIpBudget: vi.fn(later(() => undefined)),
    consumeTargetBudget: vi.fn(later((to: OtpTarget) => spend(to.target))),
    requestCode: vi.fn(
      later(
        (
          to: OtpTarget,
          purpose: OtpPurpose,
          _ip: string | null,
          options: OtpRequestOptions = {},
        ) => {
          if (!options.targetCharged) spend(to.target);
          if (locked(to.target)) throw otpLocked();
          push(to, purpose, options.context ?? null);
        },
      ),
    ),
    requestCodeIfOwned: vi.fn(
      later((to: OtpTarget, purpose: OtpPurpose, _ip: string | null, owned: boolean) => {
        spend(to.target);
        if (locked(to.target)) throw otpLocked();
        if (owned) push(to, purpose, null);
      }),
    ),
    verifyCode: vi.fn(
      later(
        (
          to: OtpTarget,
          code: string,
          purpose: OtpPurpose,
          _ip: string | null,
          options: Pick<OtpRequestOptions, 'context'> = {},
        ) => {
          if (locked(to.target)) throw otpLocked();
          const latest = [...sent]
            .reverse()
            .find(
              (s) =>
                s.to.channel === to.channel &&
                s.to.target === to.target &&
                s.purpose === purpose &&
                s.context === (options.context ?? null) &&
                !s.consumed,
            );
          if (!latest || latest.code !== code) {
            fail(to.target);
            throw otpInvalid();
          }
          latest.consumed = true;
          failures.delete(to.target);
        },
      ),
    ),
    assertNotLocked: vi.fn(
      later((target: string) => {
        if (locked(target)) throw otpLocked();
      }),
    ),
    registerFailedAttempt: vi.fn(
      later((target: string) => {
        fail(target);
      }),
    ),
    clearLock: vi.fn(
      later((target: string) => {
        failures.delete(target);
      }),
    ),
    /** The last code sent matching the filter (what the customer reads). */
    lastCode(filter: { purpose?: OtpPurpose; context?: string | null; target?: string } = {}) {
      const hit = [...sent]
        .reverse()
        .find(
          (s) =>
            (filter.purpose === undefined || s.purpose === filter.purpose) &&
            (filter.context === undefined || s.context === filter.context) &&
            (filter.target === undefined || s.to.target === filter.target),
        );
      if (!hit) throw new Error('no code sent');
      return hit;
    },
  };
  // The SMS shortcuts of the real service (otp.service.ts `requestOtp` / `verifyOtp`).
  return {
    ...otp,
    requestOtp: vi.fn((phone: string, purpose: OtpPurpose, ip: string | null) =>
      otp.requestCode({ channel: 'sms', target: phone }, purpose, ip),
    ),
    verifyOtp: vi.fn((phone: string, code: string, purpose: OtpPurpose, ip: string | null) =>
      otp.verifyCode({ channel: 'sms', target: phone }, code, purpose, ip),
    ),
  };
}

export function account(over: Partial<Account> = {}): Account {
  return {
    id: 'u-awa',
    phone: '+23566000099',
    phoneVerifiedAt: null,
    email: 'awa@example.td',
    emailVerifiedAt: new Date('2026-11-20T10:00:00Z'),
    passwordHash: null,
    hasPassword: false,
    fullName: 'Awa Hassan',
    countryId: null,
    locale: 'fr',
    status: 'active',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

/** `tx`: what `createRegisteredCustomer`'s in-transaction step receives (the registrations fake). */
export function fakeUsers(initial: Account[] = [], options: { tx?: unknown } = {}) {
  const accounts: Account[] = [...initial];
  const live = () => accounts.filter((a) => !a.deleted);
  const record = (a: Account): UserRecord => ({ ...a, hasPassword: a.passwordHash !== null });
  const find = (pred: (a: Account) => boolean) => {
    const a = live().find(pred);
    return a ? record(a) : null;
  };
  return {
    accounts,
    findByPhone: vi.fn(later((phone: string) => find((x) => x.phone === phone))),
    findByEmail: vi.fn(later((email: string) => find((x) => x.email === email))),
    findByVerifiedEmail: vi.fn(
      later((email: string) => find((x) => x.email === email && Boolean(x.emailVerifiedAt))),
    ),
    getByIdOrThrow: vi.fn(
      later((id: string) => {
        const a = find((x) => x.id === id);
        if (!a) throw new Error(`no account ${id}`);
        return a;
      }),
    ),
    findOrCreateByPhone: vi.fn(
      later((phone: string) => {
        const a = live().find((x) => x.phone === phone);
        if (a) return { userId: a.id, isNew: false };
        const created = account({
          id: `u-${accounts.length + 1}`,
          phone,
          email: null,
          emailVerifiedAt: null,
        });
        accounts.push(created);
        return { userId: created.id, isNew: true };
      }),
    ),
    createRegisteredCustomer: vi.fn(
      later(
        async (
          input: { fullName: string; phone: string; email: string; passwordHash: string },
          beforeCreate?: (tx: never) => Promise<void>,
        ) => {
          if (beforeCreate) await beforeCreate(options.tx as never);
          if (live().some((x) => x.phone === input.phone)) {
            throw new ConflictException({ code: 'PHONE_ALREADY_USED', message: 'phone taken' });
          }
          if (live().some((x) => x.email === input.email)) {
            throw new ConflictException({ code: 'EMAIL_ALREADY_USED', message: 'email taken' });
          }
          const created = account({
            id: `u-${accounts.length + 1}`,
            fullName: input.fullName,
            phone: input.phone,
            email: input.email,
            emailVerifiedAt: new Date(),
            phoneVerifiedAt: null,
            passwordHash: input.passwordHash,
          });
          accounts.push(created);
          return { userId: created.id };
        },
      ),
    ),
    getPasswordHash: vi.fn(
      later((id: string) => live().find((x) => x.id === id)?.passwordHash ?? null),
    ),
    setPasswordHash: vi.fn(
      later((id: string, hash: string) => {
        const a = live().find((x) => x.id === id);
        if (a) a.passwordHash = hash;
      }),
    ),
    /** Like `UsersService.setVerifiedEmail`: 409 `EMAIL_ALREADY_USED` when another account verified it. */
    setVerifiedEmail: vi.fn(
      later((id: string, email: string) => {
        if (live().some((x) => x.id !== id && x.email === email && x.emailVerifiedAt)) {
          throw new ConflictException({ code: 'EMAIL_ALREADY_USED', message: 'email taken' });
        }
        const a = live().find((x) => x.id === id);
        if (!a) throw new Error(`no account ${id}`);
        a.email = email;
        a.emailVerifiedAt = new Date();
        return record(a);
      }),
    ),
    markPhoneVerified: vi.fn(
      later((id: string) => {
        const a = live().find((x) => x.id === id);
        if (a && !a.phoneVerifiedAt) a.phoneVerifiedAt = new Date();
      }),
    ),
    getRoles: vi.fn(later((): Role[] => ['customer'])),
    updateLastSeen: vi.fn(later(() => undefined)),
    toMeDto: vi.fn((u: UserRecord, roles: readonly Role[]) => ({
      id: u.id,
      phone: u.phone,
      email: u.email,
      emailVerified: Boolean(u.email && u.emailVerifiedAt),
      phoneVerified: Boolean(u.phoneVerifiedAt),
      hasPassword: u.hasPassword ?? false,
      fullName: u.fullName,
      roles,
    })),
  };
}

export function fakeSessions() {
  const rows: Array<{ id: string; userId: string; revoked: string | null }> = [];
  return {
    rows,
    createSession: vi.fn(
      later(({ userId }: { userId: string }) => {
        const id = `sess-${rows.length + 1}`;
        rows.push({ id, userId, revoked: null });
        return {
          sessionId: id,
          refreshToken: `refresh-${id}`,
          expiresAt: new Date('2026-12-21T00:00:00Z'),
        };
      }),
    ),
    revokeAllForUser: vi.fn(
      later((userId: string, reason: string) => {
        const hit = rows.filter((r) => r.userId === userId && !r.revoked);
        for (const r of hit) r.revoked = reason;
        return hit.length;
      }),
    ),
    revokeAllForUserExcept: vi.fn(
      later((userId: string, keep: string, reason: string) => {
        const hit = rows.filter((r) => r.userId === userId && !r.revoked && r.id !== keep);
        for (const r of hit) r.revoked = reason;
        return hit.length;
      }),
    ),
  };
}

export function fakeDevices() {
  const rows: Array<{ token: string; userId: string; revoked: string | null; expired?: boolean }> =
    [];
  return {
    rows,
    trust: vi.fn(
      later((userId: string) => {
        const token = `device-${rows.length + 1}`;
        rows.push({ token, userId, revoked: null });
        return { token, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
      }),
    ),
    isTrusted: vi.fn(
      later((userId: string, token: string | null | undefined) =>
        rows.some((r) => r.token === token && r.userId === userId && !r.revoked && !r.expired),
      ),
    ),
    revokeAll: vi.fn(
      later((userId: string, reason: string) => {
        const hit = rows.filter((r) => r.userId === userId && !r.revoked);
        for (const r of hit) r.revoked = reason;
        return hit.length;
      }),
    ),
  };
}

type ChallengeWhere = Partial<{
  id: string;
  kind: string;
  consumedAt: null;
  expiresAt: { gt?: Date; lt?: Date };
}>;

export function fakeChallenges() {
  const rows: ChallengeRow[] = [];
  const matches = (r: ChallengeRow, w: ChallengeWhere) =>
    (w.id === undefined || r.id === w.id) &&
    (w.kind === undefined || r.kind === w.kind) &&
    (w.consumedAt !== null || r.consumedAt === null) &&
    (!w.expiresAt?.gt || r.expiresAt > w.expiresAt.gt) &&
    (!w.expiresAt?.lt || r.expiresAt < w.expiresAt.lt);
  const prisma = {
    authChallenge: {
      create: vi.fn(
        later(
          ({
            data,
          }: {
            data: Partial<ChallengeRow> & Pick<ChallengeRow, 'kind' | 'email' | 'expiresAt'>;
          }) => {
            const n = String(rows.length + 1).padStart(12, '0');
            const row: ChallengeRow = {
              id: `00000000-0000-4000-8000-${n}`,
              userId: null,
              payload: {},
              consumedAt: null,
              ...data,
            };
            rows.push(row);
            return { id: row.id };
          },
        ),
      ),
      findFirst: vi.fn(
        later(
          ({ where }: { where: ChallengeWhere }) => rows.find((r) => matches(r, where)) ?? null,
        ),
      ),
      updateMany: vi.fn(
        later(({ where, data }: { where: ChallengeWhere; data: Partial<ChallengeRow> }) => {
          const hit = rows.filter((r) => matches(r, where));
          for (const r of hit) Object.assign(r, data);
          return { count: hit.length };
        }),
      ),
      deleteMany: vi.fn(
        later(({ where }: { where: ChallengeWhere }) => {
          const keep = rows.filter((r) => !matches(r, where));
          const count = rows.length - keep.length;
          rows.splice(0, rows.length, ...keep);
          return { count };
        }),
      ),
    },
  };
  return { rows, prisma: prisma as unknown as PrismaService };
}

export function fakeNotices() {
  const sent: AccountNotice[] = [];
  const port: AccountNoticePort & { sent: AccountNotice[] } = {
    sent,
    send: vi.fn(
      later((notice: AccountNotice): NoticeOutcome => {
        sent.push(notice);
        return 'sent';
      }),
    ),
  };
  return port;
}

export function fakeAudit() {
  const log = vi.fn(later((_entry: unknown) => undefined));
  return { log, service: { log } as unknown as AuditService };
}

/** `listAuthMethods` inputs: e-mail on, SMS and WhatsApp off by default (production today). */
export function fakeConfig(values: Record<string, unknown> = {}): AppConfigService {
  const all: Record<string, unknown> = {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'smtp',
    SMS_PROVIDER: 'disabled',
    WHATSAPP_PROVIDER: 'mock',
    WHATSAPP_BUSINESS_NUMBER: '+23560000001',
    ...values,
  };
  return {
    get: (k: string) => all[k],
    isProduction: all['NODE_ENV'] === 'production',
  } as unknown as AppConfigService;
}

export function fakePlatform() {
  return {
    getPasswordLoginRateLimitPerIp: vi.fn(later(() => ({ limit: 50, windowSeconds: 900 }))),
    getTrustedDeviceTtlSeconds: vi.fn(later(() => 30 * 24 * 3600)),
  } as unknown as PlatformService;
}

export function fakeRateLimiter(allowed = true) {
  const consume = vi.fn(later(() => ({ allowed, remaining: allowed ? 1 : 0 })));
  return { consume, service: { consume } as unknown as RateLimiterService };
}

/** The real AuthService (status gate, session, audit) on fake sessions and tokens. */
export function realAuth(
  otp: ReturnType<typeof fakeOtp>,
  users: ReturnType<typeof fakeUsers>,
  sessions: ReturnType<typeof fakeSessions>,
  audit: AuditService,
): AuthService {
  let n = 0;
  const tokens = {
    signAccessToken: vi.fn(() => ({
      token: `access-${(n += 1)}`,
      expiresAt: new Date('2026-11-21T12:15:00Z'),
    })),
  } as unknown as TokenService;
  return new AuthService(
    otp as unknown as OtpService,
    users as unknown as UsersService,
    sessions as unknown as SessionService,
    tokens,
    {} as MfaService,
    audit,
  );
}

export const asOtp = (o: ReturnType<typeof fakeOtp>) => o as unknown as OtpService;
export const asUsers = (u: ReturnType<typeof fakeUsers>) => u as unknown as UsersService;
export const asSessions = (s: ReturnType<typeof fakeSessions>) => s as unknown as SessionService;
export const asDevices = (d: ReturnType<typeof fakeDevices>) =>
  d as unknown as TrustedDeviceService;
