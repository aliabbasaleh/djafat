import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { UsersService } from '../users/users.service';
import { LedgerReadService } from '../ledger/ledger-read.service';
import { RestaurantsManagementService } from './restaurants-management.service';
import { MenuCategoriesService } from './menu-categories.service';
import { ProductsManagementService } from './products-management.service';
import {
  CreateRestaurantSchema,
  UpdateRestaurantSchema,
  type CreateRestaurantInput,
  type UpdateRestaurantInput,
} from './dto/restaurant-management.schema';
import {
  CreateMenuCategorySchema,
  UpdateMenuCategorySchema,
  type CreateMenuCategoryInput,
  type UpdateMenuCategoryInput,
} from './dto/menu-category.schema';
import {
  CreateOptionGroupSchema,
  CreateProductSchema,
  UpdateOptionGroupSchema,
  UpdateProductAvailabilitySchema,
  UpdateProductSchema,
  type CreateOptionGroupInput,
  type CreateProductInput,
  type UpdateOptionGroupInput,
  type UpdateProductAvailabilityInput,
  type UpdateProductInput,
} from './dto/product-management.schema';
import {
  ReplaceRestaurantHoursSchema,
  type ReplaceRestaurantHoursInput,
} from './dto/restaurant-hours.schema';

/**
 * Restaurant/menu management (docs/20 §10, §35-§36). Every write here is
 * `@RequireAuth()` + a permission gate + an authorization check resolved
 * INSIDE the service (`RestaurantsManagementService.assertCanManage`,
 * Bloc 9.1, docs/31 §restaurant-ownership) — never `@RequireOwnership`
 * (which only supports single-owner-id equality; restaurant authority is a
 * MEMBERSHIP question, `restaurant_owner`/`restaurant_staff` via
 * `user_roles`, same mechanism `orders.confirm/ready/reject` already uses).
 * `actor.permissions.includes('admin:write')` is passed through explicitly
 * — only admin/super_admin hold it (docs/19 seed), so an owner/staff member
 * can never accidentally "override" their way into someone else's
 * restaurant just by having `restaurants:write`/`menus:write` (docs/20 §10,
 * §51 — same non-escalation guarantee as before, different mechanism).
 */
@ApiTags('catalog-management')
@Controller()
export class CatalogManagementController {
  constructor(
    private readonly restaurants: RestaurantsManagementService,
    private readonly categories: MenuCategoriesService,
    private readonly products: ProductsManagementService,
    private readonly users: UsersService,
    private readonly ledgerRead: LedgerReadService,
  ) {}

  /**
   * Read-only balance for the caller's OWN restaurant (Bloc 9, docs/30
   * §ledger-read) — resolved via `user_roles.scope_restaurant_id`
   * (`restaurant_owner`/`restaurant_staff` both qualify, matching
   * `isMemberOfRestaurant`'s semantics), NOT `Restaurant.ownerUserId`
   * (that field is catalog display metadata only — see
   * `common/ports/restaurant-membership.port.ts` — so a staff member with
   * no `ownerUserId` entry still sees their restaurant's balance here).
   */
  @Get('restaurants/me/balance')
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  async myRestaurantBalance(@CurrentActor() actor: AuthenticatedActor) {
    const restaurantId = await this.users.getRestaurantScope(actor.userId);
    if (!restaurantId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No restaurant is scoped to this account.',
      });
    }
    return this.ledgerRead.getOwnerBalances('restaurant', restaurantId);
  }

  /** The caller's OWN restaurant profile (Bloc 10, docs/33 §profile) — scope resolved server-side, same pattern as `myRestaurantBalance`. */
  @Get('restaurants/me')
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  getMine(@CurrentActor() actor: AuthenticatedActor) {
    return this.restaurants.getMine(actor.userId);
  }

  /**
   * The caller's OWN full menu tree, unfiltered by active/availability
   * status (Bloc 10, docs/33 §menu) — see `MenuCategoriesService.
   * listForManagement` for why this must NOT reuse the customer-facing
   * `CatalogService.getMenu`. `restaurants:read` is granted to BOTH
   * `restaurant_owner` and `restaurant_staff` (seed, docs/19), same tier as
   * `myRestaurantBalance`.
   */
  @Get('restaurants/me/menu')
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  async getMyMenu(@CurrentActor() actor: AuthenticatedActor) {
    const restaurantId = await this.users.getRestaurantScope(actor.userId);
    if (!restaurantId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No restaurant is scoped to this account.',
      });
    }
    return this.categories.listForManagement(restaurantId);
  }

  /**
   * Replaces the caller's OWN weekly opening hours (Bloc 10, docs/33
   * §hours). `restaurants:write` — owner tier only, same boundary already
   * drawn for every other restaurant-level (as opposed to menu-level)
   * setting in this controller; `restaurant_staff` holds `menus:write` but
   * not `restaurants:write` (seed, docs/19), so a staff member can 86 a
   * product but cannot change when the kitchen opens.
   */
  @Put('restaurants/me/hours')
  @RequireAuth()
  @RequirePermission('restaurants:write')
  async replaceMyHours(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(ReplaceRestaurantHoursSchema)) body: ReplaceRestaurantHoursInput,
  ) {
    const hours = await this.restaurants.replaceHours(actor.userId, body);
    return { hours };
  }

  @Post('restaurants')
  @RequireAuth()
  @RequirePermission('restaurants:write')
  createRestaurant(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(CreateRestaurantSchema)) body: CreateRestaurantInput,
  ) {
    return this.restaurants.create(actor.userId, body);
  }

  @Patch('restaurants/:id')
  @RequireAuth()
  @RequirePermission('restaurants:write')
  updateRestaurant(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRestaurantSchema)) body: UpdateRestaurantInput,
  ) {
    return this.restaurants.update(
      actor.userId,
      id,
      body,
      actor.permissions.includes('admin:write'),
    );
  }

  @Post('restaurants/:id/categories')
  @RequireAuth()
  @RequirePermission('menus:write')
  async createCategory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') restaurantId: string,
    @Body(new ZodValidationPipe(CreateMenuCategorySchema)) body: CreateMenuCategoryInput,
  ) {
    await this.restaurants.assertCanManage(
      actor.userId,
      restaurantId,
      actor.permissions.includes('admin:write'),
    );
    return this.categories.create(actor.userId, restaurantId, body);
  }

  @Patch('categories/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  updateCategory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMenuCategorySchema)) body: UpdateMenuCategoryInput,
  ) {
    return this.categories.update(
      actor.userId,
      id,
      body,
      actor.permissions.includes('admin:write'),
    );
  }

  @Post('restaurants/:id/products')
  @RequireAuth()
  @RequirePermission('menus:write')
  async createProduct(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') restaurantId: string,
    @Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProductInput,
  ) {
    await this.restaurants.assertCanManage(
      actor.userId,
      restaurantId,
      actor.permissions.includes('admin:write'),
    );
    return this.products.create(actor.userId, restaurantId, body);
  }

  @Patch('products/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  updateProduct(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(actor.userId, id, body, actor.permissions.includes('admin:write'));
  }

  @Patch('products/:id/availability')
  @RequireAuth()
  @RequirePermission('menus:write')
  updateProductAvailability(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductAvailabilitySchema))
    body: UpdateProductAvailabilityInput,
  ) {
    return this.products.patchAvailability(
      actor.userId,
      id,
      body.isAvailable,
      actor.permissions.includes('admin:write'),
    );
  }

  @Post('products/:id/option-groups')
  @RequireAuth()
  @RequirePermission('menus:write')
  createOptionGroup(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(CreateOptionGroupSchema)) body: CreateOptionGroupInput,
  ) {
    return this.products.createOptionGroup(
      actor.userId,
      productId,
      body,
      actor.permissions.includes('admin:write'),
    );
  }

  @Patch('option-groups/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  updateOptionGroup(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOptionGroupSchema)) body: UpdateOptionGroupInput,
  ) {
    return this.products.updateOptionGroup(
      actor.userId,
      id,
      body,
      actor.permissions.includes('admin:write'),
    );
  }
}
