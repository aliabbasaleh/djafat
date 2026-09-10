import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { API_VERSION_PREFIX } from '@djafat/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { AppConfigService } from './common/config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: 1_048_576,
      genReqId: () => crypto.randomUUID(),
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(PinoLogger));
  const config = app.get(AppConfigService);

  // Security baseline (docs/16 §21).
  // The standalone @fastify/* plugin types and the fastify instance bundled by
  // @nestjs/platform-fastify are structurally identical but nominally distinct;
  // `as never` bridges the register() overload without resorting to `any`.
  await app.register(helmet as never, { contentSecurityPolicy: config.isProduction });
  await app.register(cors as never, {
    origin: config.get('API_CORS_ORIGINS').length > 0 ? config.get('API_CORS_ORIGINS') : false,
    credentials: true,
  });

  // /v1 URI versioning (docs/07 §7.1).
  app.setGlobalPrefix(API_VERSION_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // OpenAPI foundation (protected outside production by an ops-only proxy later).
  if (!config.isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('DJAFAT API')
      .setDescription('Bloc 0 — foundation surface (health, readiness, public config).')
      .setVersion('v1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(`${API_VERSION_PREFIX}/docs`, app, SwaggerModule.createDocument(app, doc));
  }

  const host = config.get('API_HOST');
  const port = config.get('API_PORT');
  await app.listen(port, host);
  new Logger('bootstrap').log(
    `DJAFAT API listening on http://${host}:${port}/${API_VERSION_PREFIX}`,
  );
}

void bootstrap();
