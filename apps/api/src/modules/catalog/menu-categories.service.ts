import { Injectable, NotFoundException } from '@nestjs/common';
import type { MoneyJson } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { RestaurantsManagementService } from './restaurants-management.service';
import type { CreateMenuCategoryInput, UpdateMenuCategoryInput } from './dto/menu-category.schema';

export interface MenuCategoryAdminDto {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface ManagementOptionDto {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: MoneyJson;
  readonly isAvailable: boolean;
}

export interface ManagementOptionGroupDto {
  readonly id: string;
  readonly name: string;
  readonly selectionType: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly ManagementOptionDto[];
}

export interface ManagementProductDto {
  readonly id: string;
  readonly categoryId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly price: MoneyJson;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
  readonly sortOrder: number;
  readonly optionGroups: readonly ManagementOptionGroupDto[];
}

export interface MenuCategoryWithProductsDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly products: readonly ManagementProductDto[];
}

/**
 * Category CRUD — authorization resolved up to the parent restaurant via
 * `RestaurantsManagementService.assertCanManage` (Bloc 9.1, docs/31
 * §restaurant-ownership) — `user_roles` membership, not `ownerUserId`.
 */
@Injectable()
export class MenuCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly restaurants: RestaurantsManagementService,
  ) {}

  async create(
    actorUserId: string,
    restaurantId: string,
    input: CreateMenuCategoryInput,
  ): Promise<MenuCategoryAdminDto> {
    const category = await this.prisma.menuCategory.create({
      data: {
        restaurantId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'MENU_CATEGORY_CREATED',
      entityType: 'menu_category',
      entityId: category.id,
      after: { name: category.name, restaurantId },
    });
    return this.toDto(category);
  }

  async update(
    actorUserId: string,
    categoryId: string,
    input: UpdateMenuCategoryInput,
    isAdminTier: boolean,
  ): Promise<MenuCategoryAdminDto> {
    const category = await this.getByIdOrThrow(categoryId);
    await this.restaurants.assertCanManage(actorUserId, category.restaurantId, isAdminTier);
    const updated = await this.prisma.menuCategory.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'MENU_CATEGORY_UPDATED',
      entityType: 'menu_category',
      entityId: categoryId,
    });
    return this.toDto(updated);
  }

  /**
   * The full menu tree for the restaurant's OWN management screens (Bloc 10,
   * docs/33 §menu) — deliberately UNFILTERED by `isActive`/`isAvailable`, the
   * opposite of `CatalogService.getMenu`'s customer-facing read (which drops
   * exactly those rows, Bloc 2 docs/20 §39). A restaurant owner editing their
   * menu must see a paused category and an 86'd product to re-enable them —
   * hiding them here would make "dispo rapide" (quick availability toggle)
   * impossible for anything already toggled off. Authorization is the
   * caller's job (the controller resolves `restaurantId` from the actor's own
   * scope, or runs `assertCanManage` for an admin acting on another
   * restaurant); this method trusts the `restaurantId` it is given, same as
   * every other `restaurantId`-scoped read in this module.
   *
   * Inherits one Bloc-2 characteristic unchanged: the tree is walked
   * CATEGORY-first (`menuCategory.findMany(...).products`), so a product
   * with `categoryId: null` is invisible here too, exactly as it already is
   * on the customer-facing `CatalogService.getMenu`. `apps/restaurant`'s own
   * product form (Bloc 10) works around this by never offering "no
   * category" as a choice, rather than silently reproducing the trap in a
   * brand-new UI — see `ProductFormModal`'s doc comment.
   */
  async listForManagement(restaurantId: string): Promise<MenuCategoryWithProductsDto[]> {
    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          orderBy: { sortOrder: 'asc' },
          include: {
            optionGroups: {
              orderBy: { sortOrder: 'asc' },
              include: { options: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      products: c.products.map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        slug: p.slug,
        name: p.name,
        description: p.description,
        imageUrl: p.imageUrl,
        price: toMoneyJson(p.priceMinor, p.currency),
        isActive: p.isActive,
        isAvailable: p.isAvailable,
        sortOrder: p.sortOrder,
        optionGroups: p.optionGroups.map((g) => ({
          id: g.id,
          name: g.name,
          selectionType: g.selectionType,
          minSelections: g.minSelections,
          maxSelections: g.maxSelections,
          isRequired: g.isRequired,
          options: g.options.map((o) => ({
            id: o.id,
            name: o.name,
            priceDelta: toMoneyJson(o.priceDeltaMinor, o.currency),
            isAvailable: o.isAvailable,
          })),
        })),
      })),
    }));
  }

  private async getByIdOrThrow(id: string) {
    const category = await this.prisma.menuCategory.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Menu category ${id} not found.` });
    }
    return category;
  }

  private toDto(c: {
    id: string;
    restaurantId: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
  }): MenuCategoryAdminDto {
    return {
      id: c.id,
      restaurantId: c.restaurantId,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
    };
  }
}
