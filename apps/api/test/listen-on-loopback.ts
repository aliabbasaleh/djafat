import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Starts the test app on 127.0.0.1 and returns its HTTP server (audit finding
 * TEST-04).
 *
 * Given a server that is not listening, supertest opens it on a fresh random
 * port for every request, on the IPv6 wildcard, then connects to 127.0.0.1. On
 * macOS that bind succeeds even when another program already listens on
 * 127.0.0.1 with the same port number (Prisma's binary query engine does, in
 * every test file), and the request reaches that program instead: the suite
 * failed now and then with a 404 the API never logged, or hung for 30 s.
 * Bound to 127.0.0.1 itself, the app gets a port that is free there (the OS
 * refuses a taken one), and supertest and the Socket.IO clients reuse it.
 */
export async function listenOnLoopback(app: NestFastifyApplication): Promise<Server> {
  await app.listen(0, '127.0.0.1');
  return app.getHttpAdapter().getInstance().server as unknown as Server;
}
