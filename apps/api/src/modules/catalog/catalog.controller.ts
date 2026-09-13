import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CatalogService } from './catalog.service';
import {
  ListRestaurantsQuerySchema,
  type ListRestaurantsQueryInput,
} from './dto/list-restaurants.schema';
import {
  ListCategoriesQuerySchema,
  type ListCategoriesQueryInput,
} from './dto/list-categories.schema';

/**
 * Public catalogue reads (docs/20 §24, §34) — deliberately NO `@RequireAuth()`
 * anywhere in this controller: browsing DJAFAT never requires an account.
 * Every response comes from PostgreSQL — the client is never trusted for
 * price, availability, or restaurant/product identity (docs/20 §3).
 */
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('restaurants')
  listRestaurants(
    @Query(new ZodValidationPipe(ListRestaurantsQuerySchema)) query: ListRestaurantsQueryInput,
  ) {
    return this.catalog.listRestaurants(query);
  }

  @Get('restaurants/:slug')
  getRestaurant(@Param('slug') slug: string) {
    return this.catalog.getRestaurantBySlug(slug);
  }

  @Get('restaurants/:slug/menu')
  async getMenu(@Param('slug') slug: string) {
    const restaurant = await this.catalog.getRestaurantBySlug(slug);
    return this.catalog.getMenu(restaurant.id);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.catalog.getProductDetail(id);
  }

  @Get('categories')
  listCategories(
    @Query(new ZodValidationPipe(ListCategoriesQuerySchema)) query: ListCategoriesQueryInput,
  ) {
    return this.catalog.listCategories(query);
  }
}
