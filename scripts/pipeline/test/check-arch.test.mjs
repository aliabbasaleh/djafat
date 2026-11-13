// Proves that every architecture rule fails on a representative violation and
// that the legitimate patterns of this repository pass.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkArch } from '../check-arch.mjs';
import { makeTree, messages, runCli } from './helpers.mjs';

const PROJECTS = [
  { name: 'api', paths: ['apps/api/src'], tsConfig: null },
  { name: 'web', paths: ['apps/web/src'], tsConfig: null, atAlias: 'apps/web/src' },
  { name: 'packages', paths: ['packages/*/src'], tsConfig: null },
];

/** A minimal tree shaped like the real repository, with only legal edges. */
const VALID = {
  'packages/types/package.json': '{"name":"@djafat/types"}',
  'packages/types/src/index.ts': 'export type Money = { minor: bigint; currency: string };\n',
  'packages/core/package.json': '{"name":"@djafat/core"}',
  'packages/core/src/index.ts':
    "import type { Money } from '@djafat/types';\nimport { createHash } from 'node:crypto';\nexport const add = (a: Money, b: Money): Money => ({ minor: a.minor + b.minor, currency: a.currency });\nexport const h = (s: string) => createHash('sha256').update(s).digest('hex');\n",
  'packages/sdk/package.json': '{"name":"@djafat/sdk"}',
  'packages/sdk/src/index.ts':
    "import type { Money } from '@djafat/types';\nexport type Quote = { total: Money };\n",
  'apps/api/src/main.ts': "import './app.module';\n",
  'apps/api/src/app.module.ts':
    "import { OrdersModule } from './modules/orders/orders.module';\nexport const app = OrdersModule;\n",
  'apps/api/src/infra/prisma/prisma.service.ts': 'export class PrismaService {}\n',
  'apps/api/src/modules/orders/orders.module.ts':
    "import { OrdersService } from './orders.service';\nexport const OrdersModule = { OrdersService };\n",
  'apps/api/src/modules/orders/orders.controller.ts':
    "import { OrdersService } from './orders.service';\nimport type { CreateOrder } from './dto/create-order.schema';\nexport class OrdersController { constructor(private s: OrdersService) {} create(_b: CreateOrder) { return this.s; } }\n",
  'apps/api/src/modules/orders/dto/create-order.schema.ts':
    'export type CreateOrder = { cartId: string };\n',
  'apps/api/src/modules/orders/orders.service.ts':
    "import { PrismaService } from '../../infra/prisma/prisma.service';\nimport { CatalogService } from '../catalog/catalog.service';\nimport { orderCode } from './order-code';\nimport { add } from '@djafat/core';\nexport class OrdersService { constructor(private p: PrismaService, private c: CatalogService) {} code = orderCode; add = add; }\n",
  'apps/api/src/modules/orders/order-code.ts':
    "import { randomBytes } from 'node:crypto';\nexport const orderCode = () => randomBytes(4).toString('hex');\n",
  'apps/api/src/modules/orders/orders.service.spec.ts':
    "import { OrdersService } from './orders.service';\nimport { fakePrisma } from '../catalog/catalog-test-support';\nexport const t = [OrdersService, fakePrisma];\n",
  'apps/api/src/modules/catalog/catalog.service.ts': 'export class CatalogService {}\n',
  'apps/api/src/modules/catalog/catalog-test-support.ts': 'export const fakePrisma = {};\n',
  'apps/web/src/lib/session.ts':
    "import type { Quote } from '@djafat/sdk';\nexport const s: Quote | null = null;\n",
  'apps/web/src/components/Cart.tsx':
    "import { s } from '@/lib/session';\nexport const Cart = () => s;\n",
  'apps/web/src/app/page.tsx': "import { Cart } from '../components/Cart';\nexport default Cart;\n",
};

const fixtures = [];
function tree(extra = {}) {
  const t = makeTree({ ...VALID, ...extra });
  fixtures.push(t);
  return t;
}
after(() => fixtures.forEach((f) => f.cleanup()));

async function run(t, baselinePath) {
  return checkArch({ root: t.root, baselinePath, projects: PROJECTS });
}

describe('check-arch', () => {
  it('accepts the legitimate patterns of the repository', async () => {
    const { report } = await run(tree());
    assert.deepEqual(report.errors, []);
  });

  const cases = [
    [
      'a business helper importing a concrete persistence adapter',
      {
        'apps/api/src/modules/orders/order-code.ts':
          "import { PrismaService } from '../../infra/prisma/prisma.service';\nexport const orderCode = () => PrismaService;\n",
      },
      'api-pure-helper-no-io',
    ],
    [
      'a TYPE-ONLY import from a pure helper to persistence',
      {
        'apps/api/src/modules/orders/order-code.ts':
          "import type { PrismaService } from '../../infra/prisma/prisma.service';\nexport const orderCode = (_p: PrismaService) => 'x';\n",
      },
      'api-pure-helper-no-io',
    ],
    [
      'a literal dynamic import from a pure helper to persistence',
      {
        'apps/api/src/modules/orders/order-code.ts':
          "export const orderCode = async () => import('../../infra/prisma/prisma.service');\n",
      },
      'api-pure-helper-no-io',
    ],
    [
      'frontend code importing backend internals',
      {
        'apps/web/src/lib/session.ts':
          "import { OrdersService } from '../../../api/src/modules/orders/orders.service';\nexport const s = OrdersService;\n",
      },
      'frontend-not-to-backend',
    ],
    [
      'a forbidden cross-module deep import',
      {
        'apps/api/src/modules/catalog/catalog.service.ts':
          "import type { CreateOrder } from '../orders/dto/create-order.schema';\nexport class CatalogService { x?: CreateOrder; }\n",
      },
      'api-module-private-internals',
    ],
    [
      'a forbidden dependency hidden behind a barrel',
      {
        'apps/api/src/modules/orders/index.ts': "export * from './dto/create-order.schema';\n",
        'apps/api/src/modules/catalog/catalog.service.ts':
          "import type { CreateOrder } from '../orders';\nexport class CatalogService { x?: CreateOrder; }\n",
      },
      'api-module-private-internals',
    ],
    [
      'a forbidden dependency through a path alias (lib -> components)',
      {
        'apps/web/src/lib/session.ts':
          "import { Cart } from '@/components/Cart';\nexport const s = Cart;\n",
      },
      'frontend-lib-not-to-presentation',
    ],
    [
      'a newly introduced cycle',
      {
        'packages/core/src/a.ts': "import { b } from './b';\nexport const a = () => b;\n",
        'packages/core/src/b.ts': "import { a } from './a';\nexport const b = () => a;\n",
      },
      'no-circular',
    ],
    [
      'production code importing test fixtures',
      {
        'apps/api/src/modules/catalog/catalog.service.ts':
          "import { fakePrisma } from './catalog-test-support';\nexport class CatalogService { p = fakePrisma; }\n",
      },
      'no-production-to-test',
    ],
    [
      'the domain package importing a framework',
      {
        'packages/core/src/index.ts':
          "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
      },
      'domain-core-pure',
    ],
    [
      'a package importing an application',
      { 'packages/sdk/src/index.ts': "export * from '../../../apps/web/src/lib/session';\n" },
      'packages-not-to-apps',
    ],
    [
      'an unresolvable internal import (broken alias or path)',
      {
        'apps/web/src/components/Cart.tsx':
          "import { s } from '@/lib/does-not-exist';\nexport const Cart = () => s;\n",
      },
      'no-unresolvable-internal',
    ],
    [
      'a new file escaping classification',
      { 'apps/api/src/modules/orders/helpers/OrderThing.ts': 'export const thing = 1;\n' },
      'unclassified-file',
    ],
  ];

  for (const [title, extra, rule] of cases) {
    it(`rejects ${title} [${rule}]`, async () => {
      const { report } = await run(tree(extra));
      assert.match(messages(report), new RegExp(`\\[${rule}\\]`));
    });
  }

  it('tolerates a baselined violation, rejects a new one, and asks to remove a fixed one', async () => {
    const t = tree({
      'packages/core/src/a.ts': "import { b } from './b';\nexport const a = () => b;\n",
      'packages/core/src/b.ts': "import { a } from './a';\nexport const b = () => a;\n",
    });
    const first = await run(t);
    const baselinePath = join(t.root, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify({ violations: first.violations, unclassified: [] }));
    assert.deepEqual((await run(t, baselinePath)).report.errors, []);

    t.write(
      'apps/api/src/modules/orders/order-code.ts',
      "import { PrismaService } from '../../infra/prisma/prisma.service';\nexport const orderCode = () => PrismaService;\n",
    );
    assert.match(messages((await run(t, baselinePath)).report), /api-pure-helper-no-io/);

    t.write('apps/api/src/modules/orders/order-code.ts', "export const orderCode = () => 'x';\n");
    t.write('packages/core/src/b.ts', 'export const b = () => 1;\n');
    const fixed = await run(t, baselinePath);
    assert.deepEqual(fixed.report.errors, []);
    assert.match(fixed.report.warnings.map((w) => w.message).join('\n'), /baseline entry fixed/);
  });

  it('exits non-zero from the CLI on a violation', () => {
    const t = tree({
      'packages/core/src/index.ts':
        "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
    });
    const r = runCli('check-arch.mjs', ['--root', t.root, '--baseline', 'none.json']);
    assert.equal(r.code, 1, r.out);
    const ok = runCli('check-arch.mjs', ['--root', tree().root, '--baseline', 'none.json']);
    assert.equal(ok.code, 0, ok.out);
  });
});
