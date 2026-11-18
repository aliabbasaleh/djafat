/**
 * Demo fixtures (audit SEC-02): eight test accounts on published phone numbers, the
 * super_admin among them, and test restaurants. They must never reach a live server:
 * refused when `NODE_ENV=production`, unless the deployment declares itself a demo
 * (`SEED_DEMO=1`, written by `infra/deploy/gen-secrets.sh` with `MODE=demo`).
 */
export function assertFixturesAllowed(env: Readonly<Record<string, string | undefined>>): void {
  if (env['NODE_ENV'] === 'production' && env['SEED_DEMO'] !== '1') {
    throw new Error(
      'Refusing to create the demo fixtures (test accounts on published numbers, a super_admin among them) ' +
        'on a production server. A live server runs `seed-reference.ts`, then `create-super-admin.ts` ' +
        'for its first administrator; a demo server sets SEED_DEMO=1.',
    );
  }
}
