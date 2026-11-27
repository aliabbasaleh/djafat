import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { NeighbourhoodsService } from './neighbourhoods.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

// FEAT-022 — docs/features/FEAT-022-inscription-par-type-de-compte (SPEC-022-09).
// Expected outcomes come from the spec; the database is an in-memory fake that
// also enforces the partial unique index of migration 0041 (one active name per city).

interface Row {
  id: string;
  cityId: string;
  code: string | null;
  name: string;
  nameKey: string;
  active: boolean;
}

const CITY = 'city-ndj';

function fakePrisma(initial: Array<Omit<Row, 'id' | 'cityId'>>) {
  let seq = 0;
  const rows: Row[] = initial.map((r) => ({ ...r, id: `n-${(seq += 1)}`, cityId: CITY }));
  const pick = (row: Row, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k as keyof Row]])) : row;
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      k === 'NOT' ? row.id !== (v as { id: string }).id : row[k as keyof Row] === v,
    );
  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
  const assertUnique = (candidate: Row) => {
    if (
      candidate.active &&
      rows.some(
        (r) =>
          r.id !== candidate.id &&
          r.active &&
          r.cityId === candidate.cityId &&
          r.nameKey === candidate.nameKey,
      )
    ) {
      throw uniqueViolation();
    }
  };
  const prisma = {
    city: {
      findFirst: async ({ where }: { where: { slug: string } }) =>
        where.slug === 'ndjamena' ? { id: CITY } : null,
    },
    neighbourhood: {
      findMany: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => rows.filter((r) => matches(r, where)).map((r) => pick(r, select)),
      findFirst: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const row = rows.find((r) => matches(r, where));
        return row ? pick(row, select) : null;
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? pick(row, select) : null;
      },
      create: async ({
        data,
        select,
      }: {
        data: Omit<Row, 'id' | 'code' | 'active'>;
        select?: Record<string, boolean>;
      }) => {
        const row: Row = { ...data, id: `n-${(seq += 1)}`, code: null, active: true };
        assertUnique(row);
        rows.push(row);
        return pick(row, select);
      },
      update: async ({
        where,
        data,
        select,
      }: {
        where: { id: string };
        data: Partial<Row>;
        select?: Record<string, boolean>;
      }) => {
        const row = rows.find((r) => r.id === where.id)!;
        const next = { ...row, ...data };
        assertUnique(next);
        Object.assign(row, data);
        return pick(row, select);
      },
    },
  };
  return { service: new NeighbourhoodsService(prisma as unknown as PrismaService), rows };
}

const SEED = [
  { code: 'moursal', name: 'Moursal', nameKey: 'moursal', active: true },
  { code: 'klemat', name: 'Klémat', nameKey: 'klemat', active: true },
  { code: 'chagoua', name: 'Chagoua', nameKey: 'chagoua', active: true },
  { code: 'abena', name: 'Abéna', nameKey: 'abena', active: false },
];

describe('SPEC-022-09 — the neighbourhood list', () => {
  // SPEC-022-09-SC01
  it('SPEC-022-09-SC01 — the forms read the active list, by name: Chagoua, Klémat, Moursal, without Abena', async () => {
    const { service } = fakePrisma(SEED);
    const list = await service.listActive('ndjamena');
    expect(list.map((n) => n.name)).toEqual(['Chagoua', 'Klémat', 'Moursal']);
    expect(await service.listActive('unknown-city')).toEqual([]);
  });

  // SPEC-022-09-SC03
  it('SPEC-022-09-SC03 — add « Gassi Est », refuse « gassi est », disable Abena: no longer offered, never deleted', async () => {
    const { service, rows } = fakePrisma(SEED);
    const added = await service.create('ndjamena', '  Gassi   Est ');
    expect(added).toMatchObject({ name: 'Gassi Est', active: true, fromReferenceData: false });

    await expect(service.create('ndjamena', 'gassi est')).rejects.toMatchObject({
      status: 409,
      response: { code: 'NEIGHBOURHOOD_EXISTS' },
    });

    const moursal = rows.find((r) => r.code === 'moursal')!;
    await service.update(moursal.id, { active: false });
    expect((await service.listActive('ndjamena')).map((n) => n.name)).not.toContain('Moursal');
    expect(rows.some((r) => r.code === 'moursal')).toBe(true); // disabled, still there
    expect(await service.findActive(moursal.id)).toBeNull(); // sign-up refuses a disabled one
  });

  // SPEC-022-09-SC03
  it('SPEC-022-09-SC03 — renaming onto another active name is refused; a concurrent add maps to the same 409', async () => {
    const { service, rows } = fakePrisma(SEED);
    const chagoua = rows.find((r) => r.code === 'chagoua')!;
    await expect(service.update(chagoua.id, { name: 'KLEMAT' })).rejects.toMatchObject({
      response: { code: 'NEIGHBOURHOOD_EXISTS' },
    });
    const renamed = await service.update(chagoua.id, { name: 'Chagoua Centre' });
    expect(renamed).toMatchObject({ name: 'Chagoua Centre', fromReferenceData: true });

    // Re-enabling a disabled name is fine while no active one has it.
    const abena = rows.find((r) => r.code === 'abena')!;
    expect(await service.update(abena.id, { active: true })).toMatchObject({ active: true });

    await expect(service.update('missing', { active: false })).rejects.toMatchObject({
      status: 404,
      response: { code: 'NEIGHBOURHOOD_NOT_FOUND' },
    });
    await expect(service.create('unknown-city', 'Gassi')).rejects.toMatchObject({ status: 404 });
  });

  it('lists every neighbourhood for the admin console, active first', async () => {
    const { service } = fakePrisma(SEED);
    const all = await service.listAll('ndjamena');
    expect(all.map((n) => [n.name, n.active])).toEqual([
      ['Chagoua', true],
      ['Klémat', true],
      ['Moursal', true],
      ['Abéna', false],
    ]);
    expect(await service.listAll('unknown-city')).toEqual([]);
  });
});
