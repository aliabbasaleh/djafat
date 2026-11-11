# Security audit

Security posture of `main` as tested on 2026-11-10. Every item links to its entry in
[`FINDINGS.md`](FINDINGS.md), where the evidence and the fix are written out. No secret value
appears in this document.

## 1. Verdict

The authorisation model is careful and it held under test: a user could not reach another user's
or another restaurant's data by any identifier swap attempted. The weaknesses are elsewhere — in
**payment trust**, **configuration and bootstrap**, **dependencies**, and **abuse resistance**.
Three of them are enough, each alone, to rule out exposure to the internet today:

1. Anyone logged in can order without paying ([`PAY-01`](FINDINGS.md#pay-01)).
2. A deployment that keeps the example secrets is fully open ([`SEC-01`](FINDINGS.md#sec-01)).
3. The web framework in use has published remote-code-execution flaws ([`DEP-01`](FINDINGS.md#dep-01)).

## 2. What was tested and held

All LIVE unless stated.

| Area                 | Test                                                                                                              | Result                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Authentication       | No token, malformed token, token signed with another secret                                                       | 401                                                               |
| Authentication       | Wrong OTP                                                                                                         | 401, no detail leaked                                             |
| OTP abuse            | Fourth code request for one phone in ten minutes                                                                  | 429                                                               |
| Session              | Reuse of a rotated refresh token after the 5 s grace                                                              | 401; the whole session family revoked                             |
| Role walls           | Customer → admin routes; courier → restaurant board; support → finance; support → suspend user; customer → refund | 403 each                                                          |
| Tenant isolation     | Second customer reads the first's order, delivery, delivery code                                                  | 404 each                                                          |
| Tenant isolation     | Second customer reads the first's payment, pays their order, cancels their delivery                               | 403 each                                                          |
| Tenant isolation     | Second customer edits the first's address, orders to it                                                           | 404 each                                                          |
| Tenant isolation     | Owner of restaurant A edits restaurant B's profile, product, availability, category                               | 403 each                                                          |
| Privilege escalation | Admin grants `admin`; admin grants itself a role                                                                  | 403 each                                                          |
| MFA                  | Role grant without step-up                                                                                        | 428; succeeds after TOTP verification                             |
| Delivery proof       | Courier requests the customer's code                                                                              | 403; wrong code → 409, counted                                    |
| Realtime             | Anonymous or bad-token socket; stranger joins an order, restaurant or staff room                                  | Refused; no event received                                        |
| Money invariants     | All ledger groups after the full run                                                                              | Balanced (0 unbalanced)                                           |
| Append-only          | `UPDATE` on `ledger_entries`                                                                                      | Rejected by trigger                                               |
| Secrets in Git       | gitleaks over all refs, 109 commits                                                                               | 5 hits, all test fixtures; no real secret                         |
| Transport headers    | API responses                                                                                                     | HSTS, `nosniff`, frame options present; Swagger off in production |
| CORS                 | Preflight from an unlisted origin                                                                                 | No `Access-Control-Allow-Origin` returned                         |
| Input                | Malformed UUID, malformed JSON, over-limit page size                                                              | 400 / 400 / 422                                                   |
| Logging              | Authorization header, OTP and token fields                                                                        | Redacted in logs (verified in output)                             |

Design choices worth keeping: OTP codes and refresh tokens are stored only as keyed hashes; TOTP
secrets and delivery codes are encrypted at rest with separate keys; comparisons are constant-time;
amounts never come from the client; "not yours" answers as "not found"; staff-wide access requires a
staff **role** in addition to a permission.

## 3. Findings

### 3.1 Payment and financial integrity

| ID                             | Finding                                                                      | Priority |
| ------------------------------ | ---------------------------------------------------------------------------- | -------- |
| [`PAY-01`](FINDINGS.md#pay-01) | Disabled provider still chargeable; client picks the test provider's outcome | Critical |
| [`PAY-05`](FINDINGS.md#pay-05) | Unauthenticated request can shadow a genuine webhook                         | High     |
| [`PAY-04`](FINDINGS.md#pay-04) | Money kept on rejected, cancelled or failed orders                           | High     |
| [`SEC-07`](FINDINGS.md#sec-07) | Ledger write rule not enforced by the database                               | Medium   |
| [`PAY-08`](FINDINGS.md#pay-08) | Cash settlement ordering (latent)                                            | Medium   |

The test provider signs its webhooks with a constant in the source file
(`providers/mock/mock-payment.provider.ts`). That is acceptable only if the provider cannot exist
in production — which is what `PAY-01`'s fix must ensure.

### 3.2 Configuration, secrets and bootstrap

| ID                               | Finding                                                                                                                                                                                       | Priority                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`SEC-01`](FINDINGS.md#sec-01)   | Placeholder secrets accepted at boot; forged administrator token accepted                                                                                                                     | Critical                |
| [`SEC-02`](FINDINGS.md#sec-02)   | The only seed creates administrator accounts on known numbers and enables test payments                                                                                                       | High                    |
| [`AUTH-01`](FINDINGS.md#auth-01) | Only a mock OTP sender exists                                                                                                                                                                 | Critical (availability) |
| [`OPS-05`](FINDINGS.md#ops-05)   | Active branch only: a live server lacks reference data, and the obvious workaround seeds staff accounts on fixture numbers that would receive real SMS codes _(added 2026-11-11, sync S-001)_ | High                    |

### 3.3 Dependencies

| ID                             | Finding                                                      | Priority |
| ------------------------------ | ------------------------------------------------------------ | -------- |
| [`DEP-01`](FINDINGS.md#dep-01) | 8 critical and 64 high advisories in production dependencies | Critical |

Most relevant to this codebase: `next@15.1.3` (remote code execution, middleware bypass, request
forgery, denial of service); `fastify@4.29.0`, `@nestjs/platform-fastify@10.4.15` and
`@fastify/middie` (bypass and validation issues — the API uses guards rather than path-scoped
middleware, which lowers but does not remove exposure); `proxy-addr` (address spoofing, see
`SEC-04`); `@fastify/static`, `js-yaml`, `lodash` through Swagger (development only). The Expo
chain contributes many build-time advisories.

### 3.4 Authentication and session management

| ID                             | Finding                                                               | Priority |
| ------------------------------ | --------------------------------------------------------------------- | -------- |
| [`SEC-03`](FINDINGS.md#sec-03) | Anyone can lock a phone number out                                    | Medium   |
| [`SEC-08`](FINDINGS.md#sec-08) | Tokens outlive logout and role revocation by up to 15 minutes         | Medium   |
| [`SEC-05`](FINDINGS.md#sec-05) | Tokens, including 30-day refresh tokens, in `localStorage` on web     | Medium   |
| [`FE-02`](FINDINGS.md#fe-02)   | No refresh in clients (usability; pushes towards longer-lived tokens) | High     |

Notes. MFA is not required to log in as an administrator; it gates specific actions. An
administrator who never enrolled can be enrolled by whoever holds their session — the second
factor only protects accounts that already have it. Consider mandatory enrolment for staff roles.
Access tokens are HS256 with a hand-written signer and verifier (`token.service.ts`); the
implementation is small and correct as read (constant-time compare, issuer, audience and expiry
checked), but a maintained library would be easier to defend in an external review.

### 3.5 Authorisation and administration

| ID                             | Finding                                                                                | Priority |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------- |
| [`ADM-02`](FINDINGS.md#adm-02) | An admin can block a super_admin; no self-protection, no step-up, sessions not revoked | High     |
| [`ADM-01`](FINDINGS.md#adm-01) | Finance cannot step up, so its sensitive actions are unreachable                       | High     |
| [`ORD-04`](FINDINGS.md#ord-04) | Restaurant owners can create restaurants                                               | Medium   |

Structural note: **authorisation is opt-in per route.** There is no global guard; a new handler
without a decorator is public. All 95 current routes were checked and the 13 public ones are
intended. A deny-by-default global guard with an explicit `@Public()` marker would make the next
mistake impossible rather than merely unlikely.

### 3.6 Abuse resistance and exposure

| ID                             | Finding                                                                 | Priority |
| ------------------------------ | ----------------------------------------------------------------------- | -------- |
| [`SEC-04`](FINDINGS.md#sec-04) | Forwarded-for header trusted from anyone                                | Medium   |
| [`SEC-06`](FINDINGS.md#sec-06) | No general rate limit                                                   | Medium   |
| [`API-01`](FINDINGS.md#api-01) | Client mistakes produce 500s (noise, and a cheap way to trigger alerts) | Medium   |
| [`RT-01`](FINDINGS.md#rt-01)   | Socket gateway accepts any origin (token-based, so low risk)            | Low      |

### 3.7 Operations

| ID                             | Finding                                                     | Priority |
| ------------------------------ | ----------------------------------------------------------- | -------- |
| [`OPS-02`](FINDINGS.md#ops-02) | No deployment hardening, backups or monitoring              | High     |
| [`OBS-01`](FINDINGS.md#obs-01) | No error tracking or alerting; an attack would go unnoticed | Medium   |
| [`CI-01`](FINDINGS.md#ci-01)   | Security workflow permanently red                           | High     |

## 4. Not tested

- Penetration testing by an independent party; fuzzing; denial-of-service resilience.
- TLS, proxy and network configuration — none exists to test.
- The mobile apps at runtime (they do not build): storage of tokens on device was read in code
  only (`expo-secure-store`, appropriate).
- Behaviour of several API instances.
- The two unmerged branches (read only; see [`UNMERGED_BRANCHES.md`](UNMERGED_BRANCHES.md)).
- Legal and data-protection compliance (retention, consent, account deletion — the last is
  missing: [`AUTH-02`](FINDINGS.md#auth-02)).

## 5. Order of work

1. `PAY-01`, `SEC-01`, `DEP-01` (`next` first) — before anything is reachable from outside.
2. `PAY-05`, `SEC-02`, `ADM-02` — before real money or real staff accounts.
3. `SEC-03`, `SEC-04`, `SEC-06`, `SEC-08` — before public launch.
4. `SEC-05`, `SEC-07` and a deny-by-default guard — hardening.
5. An external penetration test once phases 1–3 of the roadmap are done.

Tasks: [`tasks/BACKLOG.md`](tasks/BACKLOG.md) (T-102, T-104, T-105, T-107, T-302 → T-309).

Last updated: 2026-11-11 (sync S-001)
