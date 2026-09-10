import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';

@ApiTags('config')
@Controller('config')
export class ConfigPublicController {
  constructor(private readonly platform: PlatformService) {}

  /** Bootstrap payload for every client (country, currency, timezone, flags, TTL). */
  @Get('public')
  getPublic(@Query('cityId') citySlug?: string) {
    return this.platform.getPublicConfig(citySlug);
  }
}
