import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { AddressesService } from './addresses.service';
import {
  CreateAddressSchema,
  UpdateAddressSchema,
  type CreateAddressInput,
  type UpdateAddressInput,
} from './dto/addresses.schema';

/**
 * The authenticated customer's own address book (Bloc 8, docs/29). Closes
 * the pre-Bloc-8 audit's top finding: `orders.createOrder` has always read a
 * default address, but nothing ever let a real customer create one.
 *
 * Same discipline as `couriers/me` and `notifications` (docs/25 §46, docs/27
 * §15): every route resolves identity from the token — there is no
 * `userId` route parameter anywhere in this controller, so there is nothing
 * to tamper with. Per-address ownership (`:id` routes) is enforced INSIDE
 * `AddressesService`, which answers an identical 404 whether a row does not
 * exist or belongs to someone else.
 */
@ApiTags('users')
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @RequireAuth()
  @RequireRole('customer')
  list(@CurrentActor() actor: AuthenticatedActor) {
    return this.addresses.list(actor.userId);
  }

  @Get(':id')
  @RequireAuth()
  @RequireRole('customer')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.addresses.get(actor.userId, id);
  }

  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('customer')
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(CreateAddressSchema)) body: CreateAddressInput,
  ) {
    return this.addresses.create(actor.userId, body);
  }

  @Patch(':id')
  @RequireAuth()
  @RequireRole('customer')
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAddressSchema)) body: UpdateAddressInput,
  ) {
    return this.addresses.update(actor.userId, id, body);
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('customer')
  setDefault(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.addresses.setDefault(actor.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireAuth()
  @RequireRole('customer')
  async remove(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    await this.addresses.remove(actor.userId, id);
  }
}
