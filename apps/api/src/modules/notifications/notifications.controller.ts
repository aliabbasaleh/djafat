import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth } from '../auth/decorators';
import { NotificationsService } from './notifications.service';
import {
  ListNotificationsQuerySchema,
  RegisterDeviceSchema,
  type ListNotificationsQueryInput,
  type RegisterDeviceInput,
} from './dto/notifications.schema';

/**
 * The authenticated user's own notifications and push devices (Bloc 7,
 * docs/27 §15-16).
 *
 * Every route resolves identity from the token and NEVER from a client-supplied
 * user id — there is no `userId` parameter anywhere in this controller, so
 * there is nothing to tamper with (the same discipline as `couriers/me`,
 * docs/25 §46). Ownership of an individual notification or device is enforced
 * inside the service, which answers an identical 404 whether a row does not
 * exist or belongs to somebody else.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequireAuth()
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(ListNotificationsQuerySchema)) query: ListNotificationsQueryInput,
  ) {
    return this.notifications.list(actor.userId, query.page, query.limit);
  }

  @Get('unread-count')
  @RequireAuth()
  async unreadCount(@CurrentActor() actor: AuthenticatedActor) {
    return { unread: await this.notifications.unreadCount(actor.userId) };
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequireAuth()
  markRead(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.notifications.markRead(actor.userId, id);
  }

  @Get('devices')
  @RequireAuth()
  listDevices(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.listDevices(actor.userId);
  }

  @Post('devices')
  @HttpCode(200)
  @RequireAuth()
  registerDevice(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodValidationPipe(RegisterDeviceSchema)) body: RegisterDeviceInput,
  ) {
    return this.notifications.registerDevice(actor.userId, body.platform, body.pushToken);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @RequireAuth()
  async removeDevice(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    await this.notifications.removeDevice(actor.userId, id);
  }
}
