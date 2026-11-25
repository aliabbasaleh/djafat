import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { ApplicationChange, Prisma } from '@prisma/client';

/**
 * In-memory `application_changes` for the courier and restaurant fakes
 * (FEAT-022, SPEC-022-07 R6). `where` is matched field by field; the rows
 * come back oldest first, like the services ask.
 */
export function changesTable() {
  const rows = new Map<string, ApplicationChange>();
  let created = 0;

  const later =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): Promise<R> =>
      Promise.resolve().then(() => fn(...args));
  const matches = (row: ApplicationChange, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([field, value]) => row[field as keyof ApplicationChange] === value,
    );
  const oldestFirst = (a: ApplicationChange, b: ApplicationChange) =>
    a.createdAt.getTime() - b.createdAt.getTime();

  const model = {
    findMany: vi.fn(
      later(({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()]
          .filter((row) => matches(row, where))
          .sort(oldestFirst)
          .map((row) => structuredClone(row)),
      ),
    ),
    findUnique: vi.fn(
      later(({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? structuredClone(row) : null;
      }),
    ),
    create: vi.fn(
      later(
        ({
          data,
        }: {
          data: {
            subjectType: string;
            subjectId: string;
            kind: string;
            newValue: Prisma.InputJsonValue;
          };
        }) => {
          created += 1;
          const row: ApplicationChange = {
            id: randomUUID(),
            subjectType: data.subjectType,
            subjectId: data.subjectId,
            kind: data.kind,
            newValue: structuredClone(data.newValue) as Prisma.JsonValue,
            status: 'pending',
            rejectionReason: null,
            createdAt: new Date(Date.UTC(2026, 10, 24, 8, 0, created)),
            decidedAt: null,
            decidedBy: null,
          };
          rows.set(row.id, row);
          return structuredClone(row);
        },
      ),
    ),
    update: vi.fn(
      later(({ where, data }: { where: { id: string }; data: Partial<ApplicationChange> }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error(`no change ${where.id}`);
        Object.assign(row, data);
        return structuredClone(row);
      }),
    ),
    delete: vi.fn(
      later(({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error(`no change ${where.id}`);
        rows.delete(where.id);
        return row;
      }),
    ),
  };

  return {
    rows,
    model,
    pending: (subjectId: string) =>
      [...rows.values()].filter((row) => row.subjectId === subjectId && row.status === 'pending'),
    snapshot: () => structuredClone([...rows]),
    restore: (snapshot: Array<[string, ApplicationChange]>) => {
      rows.clear();
      for (const [id, row] of snapshot) rows.set(id, row);
    },
  };
}
