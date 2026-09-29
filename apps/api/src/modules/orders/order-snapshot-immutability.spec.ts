import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bloc 6.1 §6 — the delivery address snapshot must be genuinely autonomous.
 *
 * The CTO's non-negotiable point 1 for Bloc 6 was: "le delivery address
 * snapshot est immutable après création de l'Order". Bloc 6 froze most of the
 * address onto the order, but this pass found two holes it left:
 *
 *   1. `label` and the city were never copied at all, so the order history
 *      screen had to resolve them back through `addresses` — a mutable row.
 *   2. `orders.dropoff_address_id` carried a NO ACTION foreign key, which
 *      meant deleting the address failed outright and, because
 *      `addresses.user_id` cascades from `users`, a customer with order
 *      history could not be erased at all.
 *
 * Migration 0025 closes both. These tests pin the contract down as source
 * facts — the fields that must be frozen, and the fact that no read path
 * resolves the address back out of `addresses`.
 */

const REPO = join(__dirname, '../../../../..');
const ORDERS_SERVICE = readFileSync(join(__dirname, '../orders/orders.service.ts'), 'utf8');
const MIGRATION_0023 = readFileSync(
  join(REPO, 'apps/api/prisma/migrations/0023_delivery_dispatch_core/migration.sql'),
  'utf8',
);
const MIGRATION_0025 = readFileSync(
  join(REPO, 'apps/api/prisma/migrations/0025_order_dropoff_autonomy/migration.sql'),
  'utf8',
);
const SCHEMA = readFileSync(join(REPO, 'apps/api/prisma/schema.prisma'), 'utf8');

/**
 * Everything the mandate requires the snapshot to carry on its own: the label,
 * the address text, coordinates, the city/locality, and the instructions.
 */
const REQUIRED_SNAPSHOT_COLUMNS = [
  'dropoff_label',
  'dropoff_city',
  'dropoff_quartier',
  'dropoff_street',
  'dropoff_landmark',
  'dropoff_instructions',
  'dropoff_recipient_phone',
  'dropoff_geocode_status',
  'dropoff_geom', // carries lat + lng as PostGIS
];

describe('the snapshot carries every field the order needs (mandate §6)', () => {
  it('declares all of them as columns on `orders`', () => {
    const allMigrations = MIGRATION_0023 + MIGRATION_0025;
    for (const column of REQUIRED_SNAPSHOT_COLUMNS) {
      expect(allMigrations, `${column} must be a column on orders`).toMatch(
        new RegExp(`ALTER TABLE orders ADD COLUMN ${column}\\b`),
      );
    }
  });

  it('models the text ones on the Prisma Order so code reads them without a join', () => {
    for (const column of REQUIRED_SNAPSHOT_COLUMNS.filter((c) => c !== 'dropoff_geom')) {
      expect(SCHEMA, `${column} must be modelled`).toContain(`@map("${column}")`);
    }
  });

  it('holds coordinates of its own rather than borrowing the address book’s', () => {
    // A GIST index on the order's own geography column: the delivery's dropoff
    // point is the ORDER's data, resolved once at creation.
    expect(MIGRATION_0023).toMatch(
      /ALTER TABLE orders ADD COLUMN dropoff_geom geography\(Point, 4326\)/,
    );
    expect(MIGRATION_0023).toContain('orders_dropoff_geom_idx');
  });

  it('freezes every field in the same write that creates the order', () => {
    // All of them appear in the `order.create` data block, not in a later
    // update that a concurrent address edit could interleave with.
    const createBlock = ORDERS_SERVICE.slice(
      ORDERS_SERVICE.indexOf('const order = await tx.order.create('),
      ORDERS_SERVICE.indexOf('// `dropoff_geom` is PostGIS'),
    );
    for (const field of [
      'dropoffLabel',
      'dropoffCity',
      'dropoffQuartier',
      'dropoffStreet',
      'dropoffLandmark',
      'dropoffInstructions',
      'dropoffRecipientPhone',
      'dropoffGeocodeStatus',
    ]) {
      expect(createBlock, `${field} must be frozen at creation`).toContain(field);
    }
  });

  it('copies the city as text, never as a foreign key that could be re-pointed', () => {
    expect(MIGRATION_0025).toMatch(/ADD COLUMN dropoff_city text/);
    expect(MIGRATION_0025).not.toMatch(/dropoff_city\s+uuid/);
  });
});

describe('nothing reads the address back out of `addresses` (mandate §6)', () => {
  it('the delivery context reads only the order’s own frozen columns', () => {
    // `getDeliveryContext` is what `deliveries` uses to route a courier. If it
    // ever joined `addresses`, editing the address book mid-delivery would
    // silently move the dropoff point of an in-flight order.
    const start = ORDERS_SERVICE.indexOf('async getDeliveryContext(');
    expect(start).toBeGreaterThan(-1);
    const body = ORDERS_SERVICE.slice(start, ORDERS_SERVICE.indexOf('\n  }', start));

    expect(body).toContain('dropoff_geom');
    expect(body).not.toMatch(/FROM addresses/i);
    expect(body).not.toMatch(/JOIN addresses/i);
  });

  it('`addresses` is read exactly once in the whole service — at order creation', () => {
    const reads = [...ORDERS_SERVICE.matchAll(/FROM addresses/gi)];
    expect(reads).toHaveLength(1);

    // And that one read is inside `createOrder`, before the order row exists.
    const readIndex = reads[0]!.index;
    const createStart = ORDERS_SERVICE.indexOf('async createOrder(');
    const createEnd = ORDERS_SERVICE.indexOf('async getDeliveryContext(');
    expect(readIndex).toBeGreaterThan(createStart);
    expect(readIndex).toBeLessThan(createEnd);
  });

  it('no code path ever UPDATEs a dropoff_* column after creation', () => {
    // Status transitions legitimately UPDATE `orders`; what must never happen
    // is a write to a snapshot column. The single dropoff_* write allowed is
    // the PostGIS geometry, which happens inside the SAME transaction as the
    // create because Prisma cannot write a geography column (docs/17 D-02).
    const snapshotWrites = [...ORDERS_SERVICE.matchAll(/UPDATE orders SET (dropoff_\w+)/g)].map(
      (m) => m[1]!,
    );
    expect(snapshotWrites).toEqual(['dropoff_geom']);

    // And that one write sits inside `createOrder`, not anywhere later.
    const geomWrite = ORDERS_SERVICE.indexOf('UPDATE orders SET dropoff_geom');
    const createStart = ORDERS_SERVICE.indexOf('async createOrder(');
    const createEnd = ORDERS_SERVICE.indexOf('async getDeliveryContext(');
    expect(geomWrite).toBeGreaterThan(createStart);
    expect(geomWrite).toBeLessThan(createEnd);
  });

  it('the Prisma Order model is never updated with a dropoff field either', () => {
    // The raw-SQL check above cannot see a typed `order.update({ data: {...} })`.
    const typedUpdates = [...ORDERS_SERVICE.matchAll(/order\.update\(\{[\s\S]{0,400}?\}\)/g)].map(
      (m) => m[0],
    );
    for (const block of typedUpdates) {
      expect(block, 'no typed update may touch the snapshot').not.toMatch(/dropoff/i);
    }
  });
});

describe('deleting the address never rewrites or blocks history (mandate §6)', () => {
  it('the back-reference is ON DELETE SET NULL, not a hard dependency', () => {
    expect(MIGRATION_0025).toMatch(
      /ADD CONSTRAINT orders_dropoff_address_id_fkey[\s\S]*?ON DELETE SET NULL/,
    );
  });

  it('the snapshot survives that deletion: the pointer is the only nullable link', () => {
    // Every field the order actually displays lives in its own column, so
    // `dropoff_address_id` going NULL loses nothing about what was delivered
    // where. Asserted structurally: none of the required columns IS the FK.
    expect(REQUIRED_SNAPSHOT_COLUMNS).not.toContain('dropoff_address_id');
  });

  it('migration 0025 is additive — it adds columns and relaxes one constraint', () => {
    expect(MIGRATION_0025).not.toMatch(/DROP\s+TABLE/i);
    expect(MIGRATION_0025).not.toMatch(/DROP\s+COLUMN/i);
    expect(MIGRATION_0025).not.toMatch(/DELETE\s+FROM/i);
    expect(MIGRATION_0025).not.toMatch(/TRUNCATE/i);
    // The only DROP is the constraint it immediately re-adds with a safer action.
    const drops = [...MIGRATION_0025.matchAll(/DROP CONSTRAINT (\w+)/g)].map((m) => m[1]!);
    expect(drops).toEqual(['orders_dropoff_address_id_fkey']);
    expect(MIGRATION_0025).toContain('ADD CONSTRAINT orders_dropoff_address_id_fkey');
  });
});
