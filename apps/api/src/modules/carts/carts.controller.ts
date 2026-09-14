import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { CartsService } from './carts.service';
import {
  AddCartItemSchema,
  UpdateCartItemSchema,
  type AddCartItemInput,
  type UpdateCartItemInput,
} from './dto/cart-item.schema';

/**
 * `/v1/carts` (docs/22). Every route resolves the cart from the
 * authenticated actor ONLY — never from a client-supplied cart id — so
 * there is nothing here for `@RequireOwnership` to guard: the only cart a
 * request can ever reach is, by construction, the caller's own.
 */
@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  @RequireAuth()
  @RequireRole('customer')
  async getCart(@CurrentActor() actor: AuthenticatedActor) {
    return { cart: await this.carts.getCart(actor.userId) };
  }

  @Post('items')
  @RequireAuth()
  @RequireRole('customer')
  async addItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(AddCartItemSchema)) body: AddCartItemInput,
  ) {
    return { cart: await this.carts.addItem(actor.userId, body) };
  }

  @Patch('items/:itemId')
  @RequireAuth()
  @RequireRole('customer')
  async updateItem(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateCartItemSchema)) body: UpdateCartItemInput,
  ) {
    return { cart: await this.carts.updateItem(actor.userId, itemId, body) };
  }

  @Delete('items/:itemId')
  @RequireAuth()
  @RequireRole('customer')
  async removeItem(@CurrentActor() actor: AuthenticatedActor, @Param('itemId') itemId: string) {
    return { cart: await this.carts.removeItem(actor.userId, itemId) };
  }

  @Delete()
  @RequireAuth()
  @RequireRole('customer')
  async clear(@CurrentActor() actor: AuthenticatedActor) {
    return { cart: await this.carts.clearCart(actor.userId) };
  }

  /** Live, server-computed price breakdown (docs/22 §8) — never persisted, never trusted back. */
  @Post('quote')
  @RequireAuth()
  @RequireRole('customer')
  async quote(@CurrentActor() actor: AuthenticatedActor) {
    return this.carts.computeQuote(actor.userId);
  }
}
