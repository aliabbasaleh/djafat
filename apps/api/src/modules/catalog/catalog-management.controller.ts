import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireOwnership, RequirePermission } from '../auth/decorators';
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

/**
 * Restaurant/menu management (docs/20 §10, §35-§36). Every write here is
 * `@RequireAuth()` + a permission gate + `@RequireOwnership(...)` — the
 * override permission is `admin:write` (only admin/super_admin hold it,
 * never `restaurant_owner`/`restaurant_staff` — see docs/19 seed), so an
 * owner can never accidentally "override" their way into someone else's
 * restaurant just by having `restaurants:write` (docs/20 §10, §51).
 */
@ApiTags('catalog-management')
@Controller()
export class CatalogManagementController {
  constructor(
    private readonly restaurants: RestaurantsManagementService,
    private readonly categories: MenuCategoriesService,
    private readonly products: ProductsManagementService,
  ) {}

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
  @RequireOwnership(
    RestaurantsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
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
  @RequireOwnership(
    RestaurantsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  createCategory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') restaurantId: string,
    @Body(new ZodValidationPipe(CreateMenuCategorySchema)) body: CreateMenuCategoryInput,
  ) {
    return this.categories.create(actor.userId, restaurantId, body);
  }

  @Patch('categories/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    MenuCategoriesService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  updateCategory(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMenuCategorySchema)) body: UpdateMenuCategoryInput,
  ) {
    return this.categories.update(actor.userId, id, body);
  }

  @Post('restaurants/:id/products')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    RestaurantsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  createProduct(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') restaurantId: string,
    @Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProductInput,
  ) {
    return this.products.create(actor.userId, restaurantId, body);
  }

  @Patch('products/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    ProductsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  updateProduct(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(actor.userId, id, body);
  }

  @Patch('products/:id/availability')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    ProductsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  updateProductAvailability(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductAvailabilitySchema))
    body: UpdateProductAvailabilityInput,
  ) {
    return this.products.patchAvailability(actor.userId, id, body.isAvailable);
  }

  @Post('products/:id/option-groups')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    ProductsManagementService,
    (svc, req) => svc.getOwnerUserId((req.params as { id: string }).id),
    'admin:write',
  )
  createOptionGroup(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(CreateOptionGroupSchema)) body: CreateOptionGroupInput,
  ) {
    return this.products.createOptionGroup(actor.userId, productId, body);
  }

  @Patch('option-groups/:id')
  @RequireAuth()
  @RequirePermission('menus:write')
  @RequireOwnership(
    ProductsManagementService,
    (svc, req) => svc.getOwnerUserIdForGroup((req.params as { id: string }).id),
    'admin:write',
  )
  updateOptionGroup(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOptionGroupSchema)) body: UpdateOptionGroupInput,
  ) {
    return this.products.updateOptionGroup(actor.userId, id, body);
  }
}
