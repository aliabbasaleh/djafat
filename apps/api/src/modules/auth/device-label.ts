/**
 * FEAT-023 (SPEC-023-04 R3, FEAT-023-Q13): the device of a request, in words,
 * for the e-mail « Nouvelle connexion par WhatsApp ». Read from `User-Agent`
 * only — a hint for the account's owner, never a security decision. Pure.
 */

const UNKNOWN = 'un appareil non reconnu';

/** Longest header looked at: anything longer is not a browser worth naming. */
const MAX_LENGTH = 512;

/** First match wins: Edge, Opera and Samsung Internet also say « Chrome ». */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

/** First match wins: an iPhone says « like Mac OS X », Android says « Linux ». */
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'Chromebook'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bLinux\b/, 'Linux'],
];

function first(table: ReadonlyArray<readonly [RegExp, string]>, ua: string): string | null {
  return table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim() ?? '';
  if (ua.length === 0 || ua.length > MAX_LENGTH) return UNKNOWN;
  // Only DJAFAT's own apps call the API without a browser (FEAT-023-Q13).
  if (/^okhttp\//i.test(ua)) return "l'application DJAFAT sur Android";
  if (!/Mozilla\//.test(ua) && /\bCFNetwork\//.test(ua)) return "l'application DJAFAT sur iPhone";
  const browser = first(BROWSERS, ua);
  const system = first(SYSTEMS, ua);
  if (browser && system) return `${browser} sur ${system}`;
  if (system) return `un navigateur sur ${system}`;
  return browser ?? UNKNOWN;
}
