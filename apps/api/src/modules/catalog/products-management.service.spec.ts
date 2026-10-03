import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsManagementService } from './products-management.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RestaurantsManagementService } from './restaurants-management.service';

interface ProductRow {
  id: string;
  restaurantId: string;
  categoryId: string | null;
  slug: string;
  name: string;
  priceMinor: bigint;
  currency: string;
  isActive: boolean;
  isAvailable: boolean;
}

interface GroupRow {
  id: string;
  productId: string;
  name: string;
  selectionType: string;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
}

function prismaStub(products: ProductRow[], groups: GroupRow[] = []) {
  return {
    product: {
      findUnique: vi.fn((args: { where: { id: string } }) => {
        const p = products.find((x) => x.id === args.where.id);
        return Promise.resolve(p ? { ...p, restaurant: { currency: p.currency } } : null);
      }),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = products.find((p) => p.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
    productOptionGroup: {
      findUnique: vi.fn((args: { where: { id: string } }) => {
        const g = groups.find((x) => x.id === args.where.id);
        if (!g) return Promise.resolve(null);
        const product = products.find((p) => p.id === g.productId)!;
        return Promise.resolve({ ...g, product: { restaurantId: product.restaurantId } });
      }),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = groups.find((g) => g.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
  } as unknown as PrismaService;
}

const auditStub = () => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

function restaurantsStub(allow: boolean) {
  return {
    assertCanManage: vi.fn((_actorUserId: string, _restaurantId: string, isAdminTier: boolean) => {
      if (isAdminTier || allow) return Promise.resolve({ status: 'active', ownerUserId: null });
      return Promise.reject(
        new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not belong to this restaurant.',
        }),
      );
    }),
  } as unknown as RestaurantsManagementService;
}

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    restaurantId: 'r1',
    categoryId: null,
    slug: 'p1',
    name: 'Original',
    priceMinor: 1000n,
    currency: 'XAF',
    isActive: true,
    isAvailable: true,
    ...overrides,
  };
}

describe('ProductsManagementService — authorization delegates to the restaurant (Bloc 9.1, docs/31 §restaurant-ownership)', () => {
  it('update() resolves the product’s restaurant id and asks RestaurantsManagementService', async () => {
    const products = [product()];
    const prisma = prismaStub(products);
    const restaurants = restaurantsStub(true);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurants);

    await svc.update('staff-1', 'p1', { name: 'New Name' }, false);
    expect(restaurants.assertCanManage).toHaveBeenCalledWith('staff-1', 'r1', false);
  });

  it('update() rejects a non-member — the product is left untouched', async () => {
    const products = [product()];
    const prisma = prismaStub(products);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurantsStub(false));

    await expect(svc.update('intruder', 'p1', { name: 'Hijacked' }, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(products[0]!.name).toBe('Original');
  });

  it('patchAvailability() enforces the SAME authorization as update()', async () => {
    const products = [product()];
    const prisma = prismaStub(products);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurantsStub(false));

    await expect(svc.patchAvailability('intruder', 'p1', false, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(products[0]!.isAvailable).toBe(true); // untouched
  });

  it('createOptionGroup() checks the PARENT product’s restaurant before creating anything', async () => {
    const products = [product()];
    const prisma = prismaStub(products);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurantsStub(false));

    await expect(
      svc.createOptionGroup(
        'intruder',
        'p1',
        {
          name: 'Taille',
          selectionType: 'single',
          minSelections: 1,
          maxSelections: 1,
          isRequired: true,
          options: [{ name: 'Petit', priceDeltaMinor: 0n }],
        },
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateOptionGroup() resolves restaurant id by walking group -> product -> restaurant', async () => {
    const products = [product()];
    const groups: GroupRow[] = [
      {
        id: 'g1',
        productId: 'p1',
        name: 'Taille',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
      },
    ];
    const prisma = prismaStub(products, groups);
    const restaurants = restaurantsStub(true);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurants);

    await svc.updateOptionGroup('staff-1', 'g1', { name: 'Taille (updated)' }, false);
    expect(restaurants.assertCanManage).toHaveBeenCalledWith('staff-1', 'r1', false);
  });

  it('updateOptionGroup() rejects a non-member of the GRANDPARENT restaurant', async () => {
    const products = [product()];
    const groups: GroupRow[] = [
      {
        id: 'g1',
        productId: 'p1',
        name: 'Taille',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
      },
    ];
    const prisma = prismaStub(products, groups);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurantsStub(false));

    await expect(
      svc.updateOptionGroup('intruder', 'g1', { name: 'Hijacked' }, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(groups[0]!.name).toBe('Taille');
  });

  it('throws NotFound for an unknown product/option-group before ever checking authorization', async () => {
    const prisma = prismaStub([], []);
    const restaurants = restaurantsStub(true);
    const svc = new ProductsManagementService(prisma, auditStub(), restaurants);

    await expect(svc.update('anyone', 'missing', { name: 'X' }, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.updateOptionGroup('anyone', 'missing', { name: 'X' }, false),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(restaurants.assertCanManage).not.toHaveBeenCalled();
  });
});
