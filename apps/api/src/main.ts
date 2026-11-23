import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { API_VERSION_PREFIX } from '@djafat/config';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AppConfigService } from './common/config/config.service';
import { attachSocketIoRedisAdapter } from './common/redis/socket-io-redis-adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: 1_048_576,
      genReqId: () => crypto.randomUUID(),
    }),
    // `rawBody: true` attaches `req.rawBody` (webhook signature verification,
    // docs/08 §8.6) via Nest's own default JSON parser — see bootstrap.ts.
    { bufferLogs: true, rawBody: true },
  );

  app.useLogger(app.get(PinoLogger));
  const config = app.get(AppConfigService);

  // Socket.IO on namespace /rt (docs/07 §7.12, docs/18 §18). Redis adapter
  // (Bloc 7.1, docs/28): several API instances share one fan-out, so an event
  // relayed on instance A reaches a client connected to instance B. Falls back
  // to the default in-memory adapter (single-instance fan-out only) if Redis
  // is unreachable at boot — never blocks startup on it.
  await attachSocketIoRedisAdapter(app, config.get('REDIS_URL'));

  // Raw-body parser + URI versioning + global exception filter — shared with
  // the integration test harness so the two can never drift (docs/18 §14).
  configureApp(app);

  // Security baseline (docs/16 §21).
  // The standalone @fastify/* plugin types and the fastify instance bundled by
  // @nestjs/platform-fastify are structurally identical but nominally distinct;
  // `as never` bridges the register() overload without resorting to `any`.
  await app.register(helmet as never, { contentSecurityPolicy: config.isProduction });
  await app.register(cors as never, {
    origin: config.get('API_CORS_ORIGINS').length > 0 ? config.get('API_CORS_ORIGINS') : false,
    credentials: true,
    // @fastify/cors allows only GET, HEAD and POST by default: from another
    // origin (the site on :3000, the API on :3001) the browser refused every
    // PUT, PATCH and DELETE — « Mon profil » could not save a name (PATCH /me)
    // nor a password (PUT /me/password, FEAT-020). Found by FEAT-020's
    // browser run.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

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
