import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device-label';

// FEAT-023 — docs/features/FEAT-023-whatsapp-gratuit (SPEC-023-04 R3, FEAT-023-Q13).

describe('SPEC-023-04 — the device in words', () => {
  // SPEC-023-04-SC04
  it('SPEC-023-04-SC04 — browsers and systems, the DJAFAT apps, and an unknown device', () => {
    const cases: Array<[string | null, string]> = [
      [
        'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        'Chrome sur Android',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        'Safari sur iPhone',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
        'Firefox sur Windows',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Edge sur Windows',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        'Safari sur Mac',
      ],
      ['okhttp/4.12.0', "l'application DJAFAT sur Android"],
      [null, 'un appareil non reconnu'],
    ];
    expect(cases.map(([ua]) => deviceLabel(ua))).toEqual(cases.map(([, label]) => label));
  });

  it('SPEC-023-04 « Erreurs » — an empty, huge or strange header: an unknown device', () => {
    expect(deviceLabel('')).toBe('un appareil non reconnu');
    expect(deviceLabel('x'.repeat(600))).toBe('un appareil non reconnu');
    expect(deviceLabel('curl/8.4.0')).toBe('un appareil non reconnu');
    expect(deviceLabel('DJAFAT/1 CFNetwork/1568.200.51 Darwin/24.1.0')).toBe(
      "l'application DJAFAT sur iPhone",
    );
  });
});
