import { describe, expect, it, vi } from 'vitest';
import { AddressesService } from './addresses.service';
import { CreateAddressSchema, VoiceNoteSchema } from './dto/addresses.schema';

// FEAT-018 — docs/features/FEAT-018-landmarks-learned-points (SPEC-018-01, SPEC-018-02, SPEC-018-03).

const ADDRESS = '22222222-2222-4222-8222-222222222222';
const LANDMARK = '33333333-3333-4333-8333-333333333333';

function harness(point: { count: number; lat: number | null; lng: number | null } | null) {
  const updates: unknown[][] = [];
  const notes: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: vi.fn(async () => (point ? [point] : [])),
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      updates.push(values);
      return 1;
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    // `get` (ownership): one row for the owner
    $queryRaw: vi.fn(async () => [
      {
        id: ADDRESS,
        label: 'Maison',
        recipient_phone: null,
        city_id: null,
        city_name: null,
        quartier: 'Moursal',
        street: null,
        landmark: null,
        instructions: null,
        geocode_status: 'ok',
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
        lat: 12.11,
        lng: 15.05,
        landmark_id: LANDMARK,
        landmark_name: 'Grande Mosquée',
        landmark_relation: 'behind',
        door_hint: 'portail bleu',
        geom_source: 'landmark',
        verified_count: 2,
        learned_lat: 12.1101,
        learned_lng: 15.0502,
        has_voice_note: notes.length > 0,
      },
    ]),
    addressVoiceNote: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        notes.push(create);
        return create;
      }),
    },
  };
  return { service: new AddressesService(prisma as never), updates, notes, prisma };
}

describe('SPEC-018-01 — an address placed against a landmark', () => {
  it('SPEC-018-01-SC01 — landmark, relation and door hint are accepted; the courier reads one sentence', async () => {
    expect(
      CreateAddressSchema.parse({
        landmarkId: LANDMARK,
        landmarkRelation: 'behind',
        doorHint: 'portail bleu',
      }),
    ).toMatchObject({ landmarkRelation: 'behind' });
    expect(() => CreateAddressSchema.parse({ landmarkRelation: 'under' })).toThrow();
    expect(() => CreateAddressSchema.parse({ doorHint: 'x'.repeat(81) })).toThrow();

    const a = await harness(null).service.get('user-1', ADDRESS);
    expect(a.deliveryHint).toBe('Derrière Grande Mosquée — portail bleu');
    expect(a.learnedPoint).toEqual({ lat: 12.1101, lng: 15.0502, count: 2 });
  });
});

describe('SPEC-018-02 — the point learned at delivery', () => {
  it('SPEC-018-02-SC04 — a precise fix near the known point refines it; a far one is ignored', async () => {
    const h = harness({ count: 1, lat: 12.11, lng: 15.05 });
    const ok = await h.service.learnDeliveryPoint(ADDRESS, {
      lat: 12.1102,
      lng: 15.05,
      accuracyM: 8,
    });
    expect(ok).toMatchObject({ accepted: true, point: { count: 2 } });
    expect(h.updates).toHaveLength(1);

    const far = await h.service.learnDeliveryPoint(ADDRESS, {
      lat: 12.2,
      lng: 15.05,
      accuracyM: 8,
    });
    expect(far).toEqual({ accepted: false, reason: 'too_far' });
    expect(h.updates).toHaveLength(1); // nothing written
  });
});

describe('SPEC-018-03 — the voice note for the courier', () => {
  it('SPEC-018-03-SC01 — ≤ 10 s and ≤ 40 KB, stored for the address', async () => {
    const h = harness(null);
    const small = Buffer.alloc(20_000, 1).toString('base64');
    await h.service.setVoiceNote('user-1', ADDRESS, {
      mime: 'audio/webm',
      dataBase64: small,
      durationMs: 6000,
    });
    expect(h.notes).toHaveLength(1);
    expect(() =>
      VoiceNoteSchema.parse({ mime: 'audio/webm', dataBase64: small, durationMs: 12_000 }),
    ).toThrow();
    expect(() =>
      VoiceNoteSchema.parse({ mime: 'video/mp4', dataBase64: small, durationMs: 1000 }),
    ).toThrow();
    const big = Buffer.alloc(41_500, 1).toString('base64');
    await expect(
      h.service.setVoiceNote('user-1', ADDRESS, {
        mime: 'audio/webm',
        dataBase64: big,
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
