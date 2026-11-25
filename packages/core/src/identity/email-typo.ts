/**
 * FEAT-024 (SPEC-024-04): « Vouliez-vous dire abakar@gmail.com ? ». A pure
 * suggestion for an address whose domain looks like a typo of a common
 * provider; never a refusal (the server does not use it, FEAT-024-Q11).
 */

/** R1: providers people in Chad commonly use; never corrected. */
export const KNOWN_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.fr',
  'yahoo.com',
  'hotmail.fr',
  'hotmail.com',
  'outlook.fr',
  'outlook.com',
  'live.fr',
  'live.com',
  'icloud.com',
  'ymail.com',
  'msn.com',
  'aol.com',
  'gmx.fr',
  'gmx.com',
  'mail.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'orange.fr',
  'laposte.net',
  // Real national domains of providers present in many countries (review of
  // FEAT-024, round 2): never corrected — but « hotmail.con » or « yahoo.ft »,
  // which exist nowhere, still are, by distance.
  'hotmail.be',
  'hotmail.ca',
  'hotmail.ch',
  'hotmail.co.uk',
  'hotmail.de',
  'hotmail.es',
  'hotmail.it',
  'outlook.be',
  'outlook.de',
  'outlook.es',
  'outlook.it',
  'live.be',
  'live.ca',
  'live.co.uk',
  'live.de',
  'live.it',
  'yahoo.ca',
  'yahoo.co.uk',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
] as const;

/** Providers that exist under one domain only: « gmail.fr » can only be « gmail.com ». */
const SINGLE_DOMAIN_PROVIDERS: Readonly<Record<string, string>> = {
  gmail: 'gmail.com',
  icloud: 'icloud.com',
};

const KNOWN: ReadonlySet<string> = new Set(KNOWN_EMAIL_DOMAINS);

/** Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps. */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** R2: one edit away, two for a domain of 9 characters or more. */
function closeEnough(typed: string, known: string): boolean {
  return distance(typed, known) <= (known.length >= 9 ? 2 : 1);
}

/** The closest provider, first in R1's order on a tie; `null` when none is close. */
function closestDomain(domain: string): string | null {
  let best: { domain: string; d: number } | null = null;
  for (const known of KNOWN_EMAIL_DOMAINS) {
    if (!closeEnough(domain, known)) continue;
    const d = distance(domain, known);
    if (!best || d < best.d) best = { domain: known, d };
  }
  return best?.domain ?? null;
}

/** « abakar@ymail »: the provider whose name is the closest — the exact one first (R2). */
function providerLabel(domain: string): string | null {
  let best: { domain: string; d: number } | null = null;
  for (const known of KNOWN_EMAIL_DOMAINS) {
    const d = distance(domain, known.slice(0, known.indexOf('.')));
    if (d <= 1 && (!best || d < best.d)) best = { domain: known, d };
  }
  return best?.domain ?? null;
}

/**
 * The corrected address, or `null` when nothing looks wrong. Only the domain
 * changes; the part before « @ » is kept as typed (lower-cased).
 */
export function suggestEmailFix(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (KNOWN.has(domain)) return null;

  const dot = domain.lastIndexOf('.');
  // « abakar@gmail » : the provider's name alone.
  const fixed =
    dot === -1
      ? providerLabel(domain)
      : (closestDomain(domain) ?? singleDomainProvider(domain.slice(0, dot)));
  return fixed ? `${local}@${fixed}` : null;
}

function singleDomainProvider(label: string): string | null {
  for (const [name, domain] of Object.entries(SINGLE_DOMAIN_PROVIDERS)) {
    if (distance(label, name) <= 1) return domain;
  }
  return null;
}
