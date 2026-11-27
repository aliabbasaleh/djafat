/**
 * FEAT-022 (SPEC-022-01 v3, FEAT-022-Q15): the address of another DJAFAT app,
 * derived from the API's — no setting of its own. In production every app
 * calls `https://api.<domain>/v1` (`infra/deploy/docker-compose.prod.yml`) and
 * the apps live on `<domain>`, `resto.<domain>`, `livreur.<domain>`,
 * `admin.<domain>` (`infra/deploy/Caddyfile`); on a developer's machine, on
 * their usual ports. Unknown: `null`, and the screen shows no link. Pure.
 */
export type DjafatApp = 'site' | 'restaurant' | 'courier' | 'admin';

const SUBDOMAIN: Readonly<Record<DjafatApp, string>> = {
  site: '',
  restaurant: 'resto.',
  courier: 'livreur.',
  admin: 'admin.',
};

const LOCAL_PORT: Readonly<Record<DjafatApp, number>> = {
  site: 3000,
  admin: 3002,
  restaurant: 3003,
  courier: 3004,
};

export function djafatAppUrl(apiBaseUrl: string, app: DjafatApp): string | null {
  let api: URL;
  try {
    api = new URL(apiBaseUrl);
  } catch {
    return null;
  }
  if (api.hostname.startsWith('api.')) {
    return `${api.protocol}//${SUBDOMAIN[app]}${api.hostname.slice('api.'.length)}`;
  }
  if (api.hostname === 'localhost' || api.hostname === '127.0.0.1') {
    return `${api.protocol}//${api.hostname}:${LOCAL_PORT[app]}`;
  }
  return null;
}

/** The site's sign-up form for a type (SPEC-022-01 R4, R6): `/compte?inscription=livreur`. */
export function signupUrl(apiBaseUrl: string, type: 'courier' | 'restaurant'): string | null {
  const site = djafatAppUrl(apiBaseUrl, 'site');
  return site
    ? `${site}/compte?inscription=${type === 'courier' ? 'livreur' : 'restaurant'}`
    : null;
}
