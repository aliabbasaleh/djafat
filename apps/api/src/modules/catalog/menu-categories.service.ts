import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
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
