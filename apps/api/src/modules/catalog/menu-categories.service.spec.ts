import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MenuCategoriesService } from './menu-categories.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RestaurantsManagementService } from './restaurants-management.service';

interface CategoryRow {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

function prismaStub(categories: CategoryRow[]) {
  return {
    menuCategory: {
      create: vi.fn((args: { data: Omit<CategoryRow, 'id' | 'isActive'> }) => {
        const row: CategoryRow = { id: 'c-new', isActive: true, ...args.data } as CategoryRow;
        categories.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(categories.find((c) => c.id === args.where.id) ?? null),
      ),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = categories.find((c) => c.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
  } as unknown as PrismaService;
}

const auditStub = () => ({ log: vi.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

/** `assertCanManage` is the REAL authorization decision — stubbed here to isolate `MenuCategoriesService`'s own responsibility: resolving the restaurant id and delegating. */
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

describe('MenuCategoriesService.update — authorization delegates to the restaurant (Bloc 9.1, docs/31 §restaurant-ownership)', () => {
  it('resolves the OWNING restaurant id (not Restaurant.ownerUserId) and asks RestaurantsManagementService', async () => {
    const categories: CategoryRow[] = [
      {
        id: 'cat-1',
        restaurantId: 'r1',
        name: 'Old',
        description: null,
        imageUrl: null,
        sortOrder: 0,
        isActive: true,
      },
    ];
    const prisma = prismaStub(categories);
    const restaurants = restaurantsStub(true);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurants);

    await svc.update('staff-1', 'cat-1', { name: 'New' }, false);
    expect(restaurants.assertCanManage).toHaveBeenCalledWith('staff-1', 'r1', false);
  });

  it('a rejection from assertCanManage propagates — the category is left untouched', async () => {
    const categories: CategoryRow[] = [
      {
        id: 'cat-1',
        restaurantId: 'r1',
        name: 'Original',
        description: null,
        imageUrl: null,
        sortOrder: 0,
        isActive: true,
      },
    ];
    const prisma = prismaStub(categories);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurantsStub(false));

    await expect(
      svc.update('intruder', 'cat-1', { name: 'Hijacked' }, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(categories[0]!.name).toBe('Original');
  });

  it('admin tier always succeeds regardless of the stubbed membership result', async () => {
    const categories: CategoryRow[] = [
      {
        id: 'cat-1',
        restaurantId: 'r1',
        name: 'Original',
        description: null,
        imageUrl: null,
        sortOrder: 0,
        isActive: true,
      },
    ];
    const prisma = prismaStub(categories);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurantsStub(false));

    const result = await svc.update('admin-1', 'cat-1', { name: 'Updated by admin' }, true);
    expect(result.name).toBe('Updated by admin');
  });

  it('throws NotFound for an unknown category — never calls assertCanManage with a sentinel', async () => {
    const prisma = prismaStub([]);
    const restaurants = restaurantsStub(true);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurants);

    await expect(svc.update('anyone', 'missing', { name: 'X' }, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(restaurants.assertCanManage).not.toHaveBeenCalled();
  });
});

describe('listForManagement (Bloc 10, docs/33 §menu)', () => {
  function managementPrismaStub(
    categories: Array<{
      id: string;
      name: string;
      description: string | null;
      imageUrl: string | null;
      sortOrder: number;
      isActive: boolean;
      products: Array<{
        id: string;
        categoryId: string | null;
        slug: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        priceMinor: bigint;
        currency: string;
        isActive: boolean;
        isAvailable: boolean;
        sortOrder: number;
        optionGroups: Array<{
          id: string;
          name: string;
          selectionType: string;
          minSelections: number;
          maxSelections: number;
          isRequired: boolean;
          options: Array<{
            id: string;
            name: string;
            priceDeltaMinor: bigint;
            currency: string;
            isAvailable: boolean;
          }>;
        }>;
      }>;
    }>,
  ) {
    const findMany = vi.fn((_args: { where: { restaurantId: string } }) =>
      Promise.resolve(categories),
    );
    return {
      prisma: { menuCategory: { findMany } } as unknown as PrismaService,
      findMany,
    };
  }

  it('returns inactive/unavailable rows too — the opposite of the customer-facing `getMenu`', async () => {
    const { prisma, findMany } = managementPrismaStub([
      {
        id: 'cat-1',
        name: 'Burgers',
        description: null,
        imageUrl: null,
        sortOrder: 0,
        isActive: false, // paused category — a customer would never see this
        products: [
          {
            id: 'p1',
            categoryId: 'cat-1',
            slug: 'classic-burger',
            name: 'Classic Burger',
            description: null,
            imageUrl: null,
            priceMinor: 2500n,
            currency: 'XAF',
            isActive: true,
            isAvailable: false, // 86'd — also hidden from customers
            sortOrder: 0,
            optionGroups: [
              {
                id: 'g1',
                name: 'Size',
                selectionType: 'single',
                minSelections: 1,
                maxSelections: 1,
                isRequired: true,
                options: [
                  {
                    id: 'o1',
                    name: 'Large',
                    priceDeltaMinor: 500n,
                    currency: 'XAF',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurantsStub(true));

    const result = await svc.listForManagement('r1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { restaurantId: 'r1' } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.isActive).toBe(false);
    expect(result[0]!.products[0]!.isAvailable).toBe(false);
    expect(result[0]!.products[0]!.price).toEqual({ minor: '2500', currency: 'XAF' });
    expect(result[0]!.products[0]!.optionGroups[0]!.options[0]!).toMatchObject({
      name: 'Large',
      priceDelta: { minor: '500', currency: 'XAF' },
    });
  });

  it('an empty menu returns an empty array, not an error', async () => {
    const { prisma } = managementPrismaStub([]);
    const svc = new MenuCategoriesService(prisma, auditStub(), restaurantsStub(true));
    await expect(svc.listForManagement('r1')).resolves.toEqual([]);
  });
});
