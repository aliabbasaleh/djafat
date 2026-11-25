import { describe, expect, it } from 'vitest';
import { MAX_SIDE_PX, photoForUpload, scaledSize } from './photo';

// FEAT-022 — SPEC-022-04 R2, FEAT-022-Q09 (review of part 3, #7).

describe('photoForUpload — reduced in the browser before it leaves', () => {
  it('the longest side comes down to 2 560 px, the proportions kept; a small photo is never enlarged', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: MAX_SIDE_PX, height: 1920 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1920, height: MAX_SIDE_PX });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('a photo under 4 MB leaves as it is', async () => {
    const small = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
    expect(await photoForUpload(small)).toBe(small);
  });
});
