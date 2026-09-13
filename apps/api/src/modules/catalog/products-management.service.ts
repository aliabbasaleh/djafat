import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { slugify } from './slugify';
import type {
  CreateOptionGroupInput,
  CreateProductInput,
  UpdateOptionGroupInput,
  UpdateProductInput,
} from './dto/product-management.schema';

export interface ProductAdminDto {
  readonly id: string;
  readonly restaurantId: string;
  readonly categoryId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly price: { minor: string; currency: string };
  readonly isActive: boolean;
  readonly isAvailable: boolean;
}

export interface OptionGroupAdminDto {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly selectionType: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
}

/**
 * Product + option-group/option management (docs/20 §12, §15-§18, §35).
 * Ownership always resolves up to the owning restaurant (docs/20 §21) — a
 * product's or option group's "owner" IS its restaurant's owner, there is
 * no separate concept.
 */
@Injectable()
export class ProductsManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actorUserId: string,
    restaurantId: string,
    input: CreateProductInput,
  ): Promise<ProductAdminDto> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true },
    });
    const slug = await this.generateUniqueSlug(restaurantId, input.name);

    const product = await this.prisma.product.create({
      data: {
        restaurantId,
        slug,
        name: input.name,
        priceMinor: input.priceMinor,
        currency: restaurant.currency, // server-resolved from the restaurant, never client-supplied
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: product.id,
      after: { name: product.name, restaurantId },
    });
    return this.toDto(product);
  }

  async update(
    actorUserId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductAdminDto> {
    await this.getProductOrThrow(productId);
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: productId,
    });
    return this.toDto(updated);
  }

  /**
   * `isAvailable` (temporarily out of stock) is deliberately a SEPARATE,
   * lighter-weight action from the general `update` (docs/20 §19, §35) — a
   * restaurant marking a product 86'd mid-service shouldn't need the full
   * product-write payload.
   */
  async patchAvailability(
    actorUserId: string,
    productId: string,
    isAvailable: boolean,
  ): Promise<ProductAdminDto> {
    await this.getProductOrThrow(productId);
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isAvailable },
    });
    await this.audit.log({
      actorUserId,
      action: 'PRODUCT_AVAILABILITY_CHANGED',
      entityType: 'product',
      entityId: productId,
      after: { isAvailable },
    });
    return this.toDto(updated);
  }

  async createOptionGroup(
    actorUserId: string,
    productId: string,
    input: CreateOptionGroupInput,
  ): Promise<OptionGroupAdminDto> {
    const product = await this.getProductOrThrow(productId);
    const group = await this.prisma.$transaction(async (tx) => {
      const g = await tx.productOptionGroup.create({
        data: {
          productId,
          name: input.name,
          selectionType: input.selectionType,
          minSelections: input.minSelections,
          maxSelections: input.maxSelections,
          isRequired: input.isRequired,
        },
      });
      for (const [i, o] of input.options.entries()) {
        await tx.productOption.create({
          data: {
            optionGroupId: g.id,
            name: o.name,
            priceDeltaMinor: o.priceDeltaMinor,
            currency: product.restaurant.currency,
            sortOrder: i,
          },
        });
      }
      return g;
    });
    await this.audit.log({
      actorUserId,
      action: 'PRODUCT_OPTION_GROUP_CREATED',
      entityType: 'product_option_group',
      entityId: group.id,
      after: { productId, name: group.name, optionCount: input.options.length },
    });
    return this.toGroupDto(group);
  }

  async updateOptionGroup(
    actorUserId: string,
    groupId: string,
    input: UpdateOptionGroupInput,
  ): Promise<OptionGroupAdminDto> {
    await this.getOptionGroupOrThrow(groupId);
    const updated = await this.prisma.productOptionGroup.update({
      where: { id: groupId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.minSelections !== undefined ? { minSelections: input.minSelections } : {}),
        ...(input.maxSelections !== undefined ? { maxSelections: input.maxSelections } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
      },
    });
    await this.audit.log({
      actorUserId,
      action: 'PRODUCT_OPTION_GROUP_UPDATED',
      entityType: 'product_option_group',
      entityId: groupId,
    });
    return this.toGroupDto(updated);
  }

  /** For `@RequireOwnership(...)` on product-scoped routes. */
  async getOwnerUserId(productId: string): Promise<string> {
    const product = await this.getProductOrThrow(productId);
    return product.restaurant.ownerUserId ?? '00000000-0000-0000-0000-000000000000';
  }

  /** For `@RequireOwnership(...)` on option-group-scoped routes. */
  async getOwnerUserIdForGroup(groupId: string): Promise<string> {
    const group = await this.getOptionGroupOrThrow(groupId);
    return group.product.restaurant.ownerUserId ?? '00000000-0000-0000-0000-000000000000';
  }

  private async getProductOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { restaurant: { select: { ownerUserId: true, currency: true } } },
    });
    if (!product)
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Product ${id} not found.` });
    return product;
  }

  private async getOptionGroupOrThrow(id: string) {
    const group = await this.prisma.productOptionGroup.findUnique({
      where: { id },
      include: { product: { include: { restaurant: { select: { ownerUserId: true } } } } },
    });
    if (!group) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Option group ${id} not found.` });
    }
    return group;
  }

  private async generateUniqueSlug(restaurantId: string, name: string): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const existing = await this.prisma.product.findFirst({
        where: { restaurantId, slug: candidate },
      });
      if (!existing) return candidate;
    }
    throw new ConflictException({
      code: 'VALIDATION_ERROR',
      message: 'Could not generate a unique product slug.',
    });
  }

  private toDto(p: {
    id: string;
    restaurantId: string;
    categoryId: string | null;
    slug: string;
    name: string;
    priceMinor: bigint;
    currency: string;
    isActive: boolean;
    isAvailable: boolean;
  }): ProductAdminDto {
    return {
      id: p.id,
      restaurantId: p.restaurantId,
      categoryId: p.categoryId,
      slug: p.slug,
      name: p.name,
      price: toMoneyJson(p.priceMinor, p.currency),
      isActive: p.isActive,
      isAvailable: p.isAvailable,
    };
  }

  private toGroupDto(g: {
    id: string;
    productId: string;
    name: string;
    selectionType: string;
    minSelections: number;
    maxSelections: number;
    isRequired: boolean;
  }): OptionGroupAdminDto {
    return {
      id: g.id,
      productId: g.productId,
      name: g.name,
      selectionType: g.selectionType,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      isRequired: g.isRequired,
    };
  }
}
