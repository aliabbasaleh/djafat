import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { PlatformService } from './platform.service';
import { ConfigPublicController } from './config-public.controller';

/**
 * `platform` sits at the bottom of the module DAG (docs/05 §5.3): it depends on
 * nothing and is read by almost every other module.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ConfigPublicController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
